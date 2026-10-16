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
  if (!config.isBulk) {
    plan.push("nominatim");
    if (config.operatorGeoapifyKey) plan.push("operator_geoapify");
    if (config.operatorOrsKey) plan.push("operator_ors");
    if (config.userProvider === "geoapify" && config.userKey) plan.push("user_geoapify");
    if (config.userProvider === "openrouteservice" && config.userKey) plan.push("user_ors");
  } else {
    // Bulk mode: operator-managed providers ONLY
    if (config.operatorGeoapifyKey) plan.push("operator_geoapify");
    if (config.operatorOrsKey) plan.push("operator_ors");
  }
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
  if (!config.isBulk) {
    plan.push("osrm");
    if (config.operatorGeoapifyKey) plan.push("operator_geoapify");
    if (config.operatorOrsKey) plan.push("operator_ors");
    if (config.userProvider === "geoapify" && config.userKey) plan.push("user_geoapify");
    if (config.userProvider === "openrouteservice" && config.userKey) plan.push("user_ors");
  } else {
    // Bulk mode: operator-managed providers ONLY
    if (config.operatorGeoapifyKey) plan.push("operator_geoapify");
    if (config.operatorOrsKey) plan.push("operator_ors");
  }
  return plan;
}

export interface RefundCompensationPlan {
  totalPairs: number;
  succeededCount: number;
  failedCount: number;
  amountToRefund: number;
}

/**
 * Calculates refund compensation ensuring successful calculations are NEVER refunded
 * even if the batch aborted prematurely.
 */
export function planRefundCompensation(
  totalPairs: number,
  succeededCount: number
): RefundCompensationPlan {
  const safeSucceeded = Math.max(0, Math.min(totalPairs, succeededCount));
  const failedCount = totalPairs - safeSucceeded;
  return {
    totalPairs,
    succeededCount: safeSucceeded,
    failedCount,
    amountToRefund: failedCount,
  };
}

export interface RefundRpcClient {
  rpc: (
    fn: string,
    args: { p_user_id: string; p_amount: number }
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface RefundExecutionResult {
  refunded: boolean;
  creditsRemaining?: number;
  refundError?: string;
}

/**
 * Executes a refund RPC and checks for explicit database/network errors.
 * Never silently claims success if an error occurred.
 */
export async function executeCreditRefund(
  client: RefundRpcClient,
  userId: string,
  amount: number
): Promise<RefundExecutionResult> {
  if (amount <= 0) {
    return { refunded: true };
  }

  const { data, error } = await client.rpc("refund_credits", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (error) {
    return {
      refunded: false,
      refundError: `Refund RPC failed for ${amount} credits: ${error.message}`,
    };
  }

  return {
    refunded: true,
    creditsRemaining: typeof data === "number" ? data : undefined,
  };
}

