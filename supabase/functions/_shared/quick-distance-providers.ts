/**
 * Provider allowlist and limits for the anonymous quick-distance endpoint.
 * In Phase 3, public demonstration servers (Nominatim, OSRM) are completely removed.
 * Quick-distance uses operator-managed Geoapify with strict rate limits
 * (5 calculations/hour/IP, 200 calculations/day globally) and DB caching.
 */
export const QUICK_GEOCODE_PROVIDERS = ["geoapify"] as const;
export const QUICK_ROUTE_PROVIDERS = ["geoapify"] as const;

export const QUICK_DISTANCE_IP_LIMIT_PER_MINUTE = 5;
export const QUICK_DISTANCE_IP_LIMIT_PER_HOUR = 5;
export const QUICK_DISTANCE_GLOBAL_LIMIT_PER_DAY = 200;

export const quickDistanceUsesDemoServers = (): boolean =>
  [...QUICK_GEOCODE_PROVIDERS, ...QUICK_ROUTE_PROVIDERS].some(
    (p) => (p as string) === "nominatim" || (p as string) === "osrm"
  );

