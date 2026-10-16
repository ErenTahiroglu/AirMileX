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
  const hasOperatorKey = Boolean(config.operatorGeoapifyKey);
  if (!hasOperatorKey) {
    return {
      valid: false,
      error: "Operator map service is not configured. Please contact support.",
    };
  }
  return { valid: true };
}

export type GeocodeProviderType = "operator_geoapify";

export function planGeocodeProviders(config: BulkProviderConfig): GeocodeProviderType[] {
  if (config.operatorGeoapifyKey) {
    return ["operator_geoapify"];
  }
  return [];
}

export type RouteProviderType = "operator_geoapify";

export function planRouteProviders(config: BulkProviderConfig): RouteProviderType[] {
  if (config.operatorGeoapifyKey) {
    return ["operator_geoapify"];
  }
  return [];
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

