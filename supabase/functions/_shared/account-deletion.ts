export interface AccountDeletionDeps {
  deleteAuthUser: (userId: string) => Promise<{ error: Error | { message: string } | null }>;
  deleteCalculationLogs: (userId: string) => Promise<{ error: Error | { message: string } | null }>;
  deleteSavedAddressPairs: (userId: string) => Promise<{ error: Error | { message: string } | null }>;
  deleteSavedMappings: (userId: string) => Promise<{ error: Error | { message: string } | null }>;
  deleteUserSettings: (userId: string) => Promise<{ error: Error | { message: string } | null }>;
  logAttempt: (status: string, errorMessage?: string) => Promise<void>;
  checkRateLimit: (userId: string) => Promise<{
    rateLimited: boolean;
    retryAfterSec?: number;
    error?: string;
  }>;
}

export interface AccountDeletionResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Executes safe account deletion:
 * 1. Validates rate limit.
 * 2. Deletes auth user FIRST so that if auth deletion fails,
 *    no database or financial state is partially destroyed.
 * 3. Deletes dependent records with explicit error checks.
 * 4. Logs audit trail in account_deletion_attempts.
 */
export async function executeAccountDeletion(
  userId: string,
  deps: AccountDeletionDeps
): Promise<AccountDeletionResult> {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return {
      status: 400,
      body: { error: "Invalid user identifier" },
    };
  }

  // 1. Check rate limit
  const rateLimitCheck = await deps.checkRateLimit(userId);
  if (rateLimitCheck.error) {
    await deps.logAttempt("error", `rate-check failed: ${rateLimitCheck.error}`);
    return {
      status: 500,
      body: { error: "Rate-limit check failed" },
    };
  }

  if (rateLimitCheck.rateLimited) {
    await deps.logAttempt("rate_limited");
    const retryAfter = rateLimitCheck.retryAfterSec ?? 3600;
    return {
      status: 429,
      body: {
        error: "Too many deletion attempts. Try again later.",
        retry_after_seconds: retryAfter,
      },
      headers: {
        "Retry-After": String(retryAfter),
      },
    };
  }

  // 2. Auth user deletion FIRST.
  // If this fails, user_settings and all financial state remain intact.
  const { error: authErr } = await deps.deleteAuthUser(userId);
  if (authErr) {
    await deps.logAttempt("error", `auth-deletion-failed: ${authErr.message}`);
    return {
      status: 500,
      body: { error: authErr.message },
    };
  }

  // 3. Explicit cleanup of dependent tables with error tracking
  const cleanupErrors: string[] = [];

  const { error: logsErr } = await deps.deleteCalculationLogs(userId);
  if (logsErr) cleanupErrors.push(`calculation_logs: ${logsErr.message}`);

  const { error: addressErr } = await deps.deleteSavedAddressPairs(userId);
  if (addressErr) cleanupErrors.push(`saved_address_pairs: ${addressErr.message}`);

  const { error: mapsErr } = await deps.deleteSavedMappings(userId);
  if (mapsErr) cleanupErrors.push(`saved_mappings: ${mapsErr.message}`);

  const { error: settingsErr } = await deps.deleteUserSettings(userId);
  if (settingsErr) cleanupErrors.push(`user_settings: ${settingsErr.message}`);

  if (cleanupErrors.length > 0) {
    const errorMsg = `Account deleted from Auth, but cleanup failed: ${cleanupErrors.join("; ")}`;
    await deps.logAttempt("partial_failure", errorMsg);
    return {
      status: 500,
      body: { error: errorMsg },
    };
  }

  // 4. Log successful deletion
  await deps.logAttempt("success");

  return {
    status: 200,
    body: { success: true },
  };
}
