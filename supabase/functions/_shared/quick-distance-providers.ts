/**
 * Provider allowlist for the anonymous quick-distance endpoint.
 * Only free, hard-coded public services; operator-paid providers are never
 * reachable from this public path (they live behind authenticated distance-proxy).
 */
export const QUICK_GEOCODE_PROVIDERS = ["nominatim"] as const;
export const QUICK_ROUTE_PROVIDERS = ["osrm"] as const;

const PAID = new Set(["geoapify", "ors", "google"]);

export const quickDistanceUsesPaidProvider = (): boolean =>
  [...QUICK_GEOCODE_PROVIDERS, ...QUICK_ROUTE_PROVIDERS].some((p) => PAID.has(p));
