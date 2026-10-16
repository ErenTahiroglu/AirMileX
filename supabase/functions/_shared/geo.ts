/**
 * Geocoding and routing providers with strict error classification.
 *
 * Rule: a bad user address (400 / 404 / zero results) must stop the chain
 * immediately. Only provider-side trouble (429, 5xx, network timeout)
 * may trigger a failover to the next provider.
 */

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

export const httpError = (provider: string, status: number) => {
  if (status === 429) {
    return new ProviderError(`${provider} rate limit reached. Please retry in a few moments.`, true, "provider");
  }
  return new ProviderError(`${provider} responded with ${status}`, statusIsRetryable(status));
};

/** Network failures and aborts are provider problems, so they are retryable. */
export const networkError = (provider: string, err: unknown) =>
  new ProviderError(`${provider} unreachable: ${(err as Error).message}`, true);

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
  let lastError: unknown = new ProviderError("No provider available", true);
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
  if (typeof props?.distance !== "number") throw new ProviderError("No route found between these addresses", false);
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

