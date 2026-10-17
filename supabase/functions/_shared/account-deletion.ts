export interface StepUpAuthOptions {
  userEmail?: string;
  otpCode?: string;
}

export interface AccountDeletionDeps {
  verifyStepUp: (
    userId: string,
    userEmail?: string,
    otpCode?: string
  ) => Promise<{ verified: boolean; error?: string }>;
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
 * 1. Enforces server-side step-up reauthentication (valid email OTP).
 * 2. Validates rate limit.
 * 3. Deletes auth user FIRST so that if auth deletion fails,
 *    no database or financial state is partially destroyed.
 * 4. Deletes dependent records with explicit error checks.
 * 5. Logs audit trail in account_deletion_attempts with sanitized error.
 */
export async function executeAccountDeletion(
  userId: string,
  deps: AccountDeletionDeps,
  options?: StepUpAuthOptions
): Promise<AccountDeletionResult> {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return {
      status: 400,
      body: { error: "Invalid user identifier" },
    };
  }

  // 1. Enforce Server-Side Step-Up Reauthentication FIRST
  const otpCode = options?.otpCode?.trim();
  if (!otpCode) {
    return {
      status: 401,
      body: { error: "Step-up authentication required: verification code missing" },
    };
  }

  const stepUpResult = await deps.verifyStepUp(userId, options?.userEmail, otpCode);
  if (!stepUpResult.verified) {
    await deps.logAttempt("unauthorized", stepUpResult.error ?? "Invalid verification code");
    return {
      status: 401,
      body: { error: "Invalid or expired verification code" },
    };
  }

  // 2. Check rate limit
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
