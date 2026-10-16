/**
 * Pure policy and planning helpers for bulk vs non-bulk distance calculation.
 * Ensures bulk calculations require operator-managed keys, never rely on
 * public Nominatim/OSRM demo servers, and keep all credentials server-side.
 */

export interface BulkProviderConfig {
  isBulk: boolean;
  operatorGeoapifyKey?: string;
  operatorOrsKey?: string;
  userProvider?: "google" | "openrouteservice" | "geoapify";
  userKey?: string;
}

export function validateBulkProviderConfig(config: BulkProviderConfig): {
  valid: boolean;
  error?: string;
} {
  if (config.isBulk) {
    const hasOperatorKey = Boolean(config.operatorGeoapifyKey || config.operatorOrsKey);
    if (!hasOperatorKey) {
      return {
        valid: false,
        error: "Operator map service is not configured for bulk operations. Please contact support.",
      };
    }
  } else {
    const hasKey = Boolean(config.userKey || config.operatorGeoapifyKey || config.operatorOrsKey);
    if (!hasKey) {
      return {
        valid: false,
        error: "No Maps API key configured. Please add it in Settings.",
      };
    }
  }
  return { valid: true };
}

export type GeocodeProviderType =
  | "nominatim"
  | "operator_geoapify"
  | "operator_ors"
  | "user_geoapify"
  | "user_ors";

export function planGeocodeProviders(config: BulkProviderConfig): GeocodeProviderType[] {
  const plan: GeocodeProviderType[] = [];
  // In bulk mode, NEVER use public Nominatim
  if (!config.isBulk) {
    plan.push("nominatim");
  }
  if (config.operatorGeoapifyKey) plan.push("operator_geoapify");
  if (config.operatorOrsKey) plan.push("operator_ors");
  if (config.userProvider === "geoapify" && config.userKey) plan.push("user_geoapify");
  if (config.userProvider === "openrouteservice" && config.userKey) plan.push("user_ors");
  return plan;
}

export type RouteProviderType =
  | "osrm"
  | "operator_geoapify"
  | "operator_ors"
  | "user_geoapify"
  | "user_ors";

export function planRouteProviders(config: BulkProviderConfig): RouteProviderType[] {
  const plan: RouteProviderType[] = [];
  // In bulk mode, NEVER use public OSRM
  if (!config.isBulk) {
    plan.push("osrm");
  }
  if (config.operatorGeoapifyKey) plan.push("operator_geoapify");
  if (config.operatorOrsKey) plan.push("operator_ors");
  if (config.userProvider === "geoapify" && config.userKey) plan.push("user_geoapify");
  if (config.userProvider === "openrouteservice" && config.userKey) plan.push("user_ors");
  return plan;
}
