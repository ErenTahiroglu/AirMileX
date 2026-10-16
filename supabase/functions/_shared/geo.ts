/**
 * Geocoding and routing providers with strict error classification.
 *
 * Rule: a bad user address (400 / 404 / zero results) must stop the chain
 * immediately. Only provider-side trouble (429, 5xx, network timeout)
 * may trigger a failover to the next provider.
 */

import {
  planGeocodeProviders,
  planRouteProviders,
  type BulkProviderConfig,
} from "./bulk-distance-providers.ts";

export type LonLat = [number, number];

export interface RouteSummary {
  distance_m: number;
  duration_s: number;
}

export interface AddressSuggestion {
  label: string;
  lat: number;
  lon: number;
}

export interface AddressPair {
  record_id: string;
  start: string;
  end: string;
}

/** Error raised by a provider call; `retryable` decides whether to fail over. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly kind: "address" | "provider" = retryable ? "provider" : "address"
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const addressNotFound = (address: string) =>
  new ProviderError(`Address not found: ${address}`, false, "address");

export const ADDRESS_NOT_FOUND_MESSAGE = "Address not found";

/** HTTP status -> failover decision. */
export const statusIsRetryable = (status: number) => status === 429 || status >= 500;

/**
 * Maps an HTTP response status from an external provider to a ProviderError.
 * ALL HTTP failures (401, 403, 429, 500, etc.) are strictly classified as `provider` errors,
 * NEVER as invalid user addresses. This prevents provider configuration, auth, or quota
 * failures from incorrectly writing "Adres Bulunamadı" to user tables.
 */
export const httpError = (provider: string, status: number) => {
  if (status === 429) {
    return new ProviderError(
      `${provider} rate limit reached. Please retry in a few moments.`,
      true,
      "provider"
    );
  }
  return new ProviderError(
    `${provider} responded with ${status}`,
    statusIsRetryable(status),
    "provider"
  );
};

/** Network failures and aborts are provider problems, so they are retryable provider errors. */
export const networkError = (provider: string, err: unknown) =>
  new ProviderError(`${provider} unreachable: ${(err as Error).message}`, true, "provider");

export async function fetchWithTimeout(
  provider: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = 4000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw networkError(provider, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs provider attempts in order. Stops at the first success and stops
 * immediately on a non-retryable (user input) error.
 */
export async function runChain<T>(attempts: Array<() => Promise<T>>): Promise<T> {
  let lastError: unknown = new ProviderError("No provider available", true, "provider");
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof ProviderError && !err.retryable) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Default minimal pacing interval between consecutive external Geoapify requests
 * within the same Edge Function execution context.
 *
 * 220 ms per request corresponds to ~4.55 requests/sec, which is safely below
 * the published Geoapify Free tier rate limit of 5 RPS.
 */
export const DEFAULT_GEOAPIFY_PACE_MS = 220;

export interface RequestPacer {
  pace(): Promise<void>;
  getLastRequestTime(): number;
}

/**
 * Minimal per-invocation pacing helper.
 *
 * Enforces a bounded request-start interval between actual external API calls.
 * Cached lookups and coordinate inputs return immediately without throttling.
 *
 * IMPORTANT LIMITATION:
 * Per-invocation pacing bounds request rates strictly within a single Edge Function
 * invocation. It does NOT globally coordinate or enforce the account-wide 5 RPS limit
 * across concurrent Edge Function instances. Concurrent invocations share the account
 * quota and rely on bounded HTTP 429 error handling and compensating credit refunds.
 */
export function createRequestPacer(
  minIntervalMs = DEFAULT_GEOAPIFY_PACE_MS,
  sleeper: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowFn: () => number = () => Date.now()
): RequestPacer {
  let lastRequestTime = 0;

  return {
    async pace(): Promise<void> {
      const now = nowFn();
      if (lastRequestTime > 0) {
        const elapsed = now - lastRequestTime;
        if (elapsed < minIntervalMs) {
          await sleeper(minIntervalMs - elapsed);
        }
      }
      lastRequestTime = nowFn();
    },
    getLastRequestTime() {
      return lastRequestTime;
    },
  };
}

/** Matches "41.0082, 28.9784" style plain coordinate input. */
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function parseCoordinates(text: string): LonLat | null {
  const match = COORD_RE.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

const USER_AGENT = "AirMileX/1.0 (+https://airmilex.lovable.app)";

// ---------------------------------------------------------------- geocoding

export async function geoapifyGeocode(apiKey: string, address: string): Promise<LonLat> {
  if (!apiKey) throw new ProviderError("Operator map service is not configured", false, "provider");
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&limit=1&format=json&apiKey=${apiKey}`;
  const res = await fetchWithTimeout("Geoapify geocoding", url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw httpError("Geoapify geocoding", res.status);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw addressNotFound(address);
  return [hit.lon, hit.lat];
}

// ------------------------------------------------------------------ routing

export async function geoapifyRoute(
  apiKey: string,
  start: LonLat,
  end: LonLat
): Promise<RouteSummary> {
  if (!apiKey) throw new ProviderError("Operator map service is not configured", false, "provider");
  const waypoints = `${start[1]},${start[0]}|${end[1]},${end[0]}`;
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(waypoints)}&mode=drive&apiKey=${apiKey}`;
  const res = await fetchWithTimeout("Geoapify routing", url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw httpError("Geoapify routing", res.status);
  const data = await res.json();
  const props = data.features?.[0]?.properties;
  if (typeof props?.distance !== "number") {
    throw new ProviderError("No route found between these addresses", false, "address");
  }
  return { distance_m: props.distance, duration_s: props.time ?? 0 };
}

// ------------------------------------------------------------ autocomplete

export async function geoapifyAutocomplete(
  apiKey: string,
  text: string
): Promise<AddressSuggestion[]> {
  if (!apiKey) throw new ProviderError("Operator map service is not configured", false, "provider");
  const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&limit=5&format=json&apiKey=${apiKey}`;
  const res = await fetchWithTimeout("Geoapify autocomplete", url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw httpError("Geoapify autocomplete", res.status);
  const data = await res.json();
  return (data.results ?? []).map((hit: Record<string, unknown>) => ({
    label: (hit.formatted as string) ?? "",
    lat: hit.lat as number,
    lon: hit.lon as number,
  }));
}

// ------------------------------------------------------------ pair resolution & attempts

export function geocodeAttempts(config: BulkProviderConfig, address: string): Array<() => Promise<LonLat>> {
  const plan = planGeocodeProviders(config);
  const attempts: Array<() => Promise<LonLat>> = [];
  for (const p of plan) {
    if (p === "operator_geoapify" && config.operatorGeoapifyKey) {
      attempts.push(() => geoapifyGeocode(config.operatorGeoapifyKey!, address));
    }
  }
  return attempts;
}

export function routeAttempts(config: BulkProviderConfig, start: LonLat, end: LonLat): Array<() => Promise<RouteSummary>> {
  const plan = planRouteProviders(config);
  const attempts: Array<() => Promise<RouteSummary>> = [];
  for (const p of plan) {
    if (p === "operator_geoapify" && config.operatorGeoapifyKey) {
      attempts.push(() => geoapifyRoute(config.operatorGeoapifyKey!, start, end));
    }
  }
  return attempts;
}

/**
 * Resolves driving distance and duration for an address pair with per-invocation request pacing.
 *
 * Pacing Rules:
 * - Direct coordinate inputs parse immediately without consuming pacing delay.
 * - Cache hits in `geocodeCache` return immediately without consuming pacing delay.
 * - External geocode calls (cache misses) await `pacer.pace()`.
 * - External routing calls await `pacer.pace()`.
 */
export async function resolvePair(
  config: BulkProviderConfig,
  pair: AddressPair,
  geocodeCache: Map<string, LonLat>,
  pacer?: RequestPacer
): Promise<RouteSummary> {
  const getCoordinates = async (address: string): Promise<LonLat> => {
    const parsed = parseCoordinates(address);
    if (parsed) return parsed;
    const normalized = address.trim().toLowerCase();
    if (geocodeCache.has(normalized)) {
      return geocodeCache.get(normalized)!;
    }
    if (pacer) await pacer.pace();
    const coords = await runChain(geocodeAttempts(config, address));
    geocodeCache.set(normalized, coords);
    return coords;
  };

  const startCoords = await getCoordinates(pair.start);
  const endCoords = await getCoordinates(pair.end);
  if (pacer) await pacer.pace();
  return await runChain(routeAttempts(config, startCoords, endCoords));
}

