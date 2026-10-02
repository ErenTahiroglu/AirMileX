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

export const httpError = (provider: string, status: number) =>
  new ProviderError(`${provider} responded with ${status}`, statusIsRetryable(status));

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
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&limit=1&format=json&apiKey=${apiKey}`;
  const res = await fetchWithTimeout("Geoapify geocoding", url);
  if (!res.ok) throw httpError("Geoapify geocoding", res.status);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw addressNotFound(address);
  return [hit.lon, hit.lat];
}

export async function orsGeocode(apiKey: string, address: string): Promise<LonLat> {
  const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(address)}&size=1`;
  const res = await fetchWithTimeout("ORS geocoding", url);
  if (!res.ok) throw httpError("ORS geocoding", res.status);
  const data = await res.json();
  const coords = data.features?.[0]?.geometry?.coordinates;
  if (!coords) throw addressNotFound(address);
  return [coords[0], coords[1]];
}

export async function nominatimGeocode(address: string): Promise<LonLat> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout("Nominatim", url, { headers: { "User-Agent": USER_AGENT, Referer: "https://airmilex.lovable.app/" } }, 2500);
  if (!res.ok) throw httpError("Nominatim", res.status);
  const data = await res.json();
  const hit = data?.[0];
  if (!hit) throw addressNotFound(address);
  return [Number(hit.lon), Number(hit.lat)];
}

// ------------------------------------------------------------------ routing

export async function geoapifyRoute(
  apiKey: string,
  start: LonLat,
  end: LonLat
): Promise<RouteSummary> {
  const waypoints = `${start[1]},${start[0]}|${end[1]},${end[0]}`;
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(waypoints)}&mode=drive&apiKey=${apiKey}`;
  const res = await fetchWithTimeout("Geoapify routing", url);
  if (!res.ok) throw httpError("Geoapify routing", res.status);
  const data = await res.json();
  const props = data.features?.[0]?.properties;
  if (!props?.distance) throw new ProviderError("No route found between these addresses", false);
  return { distance_m: props.distance, duration_s: props.time };
}

export async function orsRoute(apiKey: string, start: LonLat, end: LonLat): Promise<RouteSummary> {
  const res = await fetchWithTimeout(
    "ORS routing",
    "https://api.openrouteservice.org/v2/directions/driving-car",
    {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [start, end] }),
    }
  );
  if (!res.ok) throw httpError("ORS routing", res.status);
  const data = await res.json();
  const summary = data.routes?.[0]?.summary;
  if (summary?.distance === undefined) {
    throw new ProviderError("No route found between these addresses", false);
  }
  return { distance_m: summary.distance, duration_s: summary.duration };
}

export async function osrmRoute(start: LonLat, end: LonLat): Promise<RouteSummary> {
  const url = `https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}?overview=false`;
  const res = await fetchWithTimeout("OSRM", url, { headers: { "User-Agent": USER_AGENT, Referer: "https://airmilex.lovable.app/" } }, 2500);
  if (!res.ok) throw httpError("OSRM", res.status);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new ProviderError("No route found between these addresses", false);
  return { distance_m: route.distance, duration_s: route.duration };
}

// ------------------------------------------------------------ autocomplete

export async function geoapifyAutocomplete(
  apiKey: string,
  text: string
): Promise<AddressSuggestion[]> {
  const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&limit=5&format=json&apiKey=${apiKey}`;
  const res = await fetchWithTimeout("Geoapify autocomplete", url);
  if (!res.ok) throw httpError("Geoapify autocomplete", res.status);
  const data = await res.json();
  return (data.results ?? []).map((hit: Record<string, unknown>) => ({
    label: (hit.formatted as string) ?? "",
    lat: hit.lat as number,
    lon: hit.lon as number,
  }));
}

export async function orsAutocomplete(
  apiKey: string,
  text: string
): Promise<AddressSuggestion[]> {
  const url = `https://api.openrouteservice.org/geocode/autocomplete?api_key=${apiKey}&text=${encodeURIComponent(text)}&size=5`;
  const res = await fetchWithTimeout("ORS autocomplete", url);
  if (!res.ok) throw httpError("ORS autocomplete", res.status);
  const data = await res.json();
  return (data.features ?? []).map((f: Record<string, any>) => ({
    label: f.properties?.label ?? "",
    lat: f.geometry?.coordinates?.[1],
    lon: f.geometry?.coordinates?.[0],
  }));
}

export async function nominatimAutocomplete(text: string): Promise<AddressSuggestion[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(text)}`;
  const res = await fetchWithTimeout("Nominatim", url, { headers: { "User-Agent": USER_AGENT, Referer: "https://airmilex.lovable.app/" } }, 2500);
  if (!res.ok) throw httpError("Nominatim", res.status);
  const data = await res.json();
  return (data ?? []).map((hit: Record<string, string>) => ({
    label: hit.display_name,
    lat: Number(hit.lat),
    lon: Number(hit.lon),
  }));
}
