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
 * Sanitizes error and audit messages to prevent leakage of PII, credentials,
 * tokens, session headers, OTP codes, and backend connection details.
 */
export function sanitizeErrorMessage(message?: string | null): string | null {
  if (!message || typeof message !== "string") return null;

  return message
    .slice(0, 500)
    // Redact connection strings (e.g. postgres://user:pass@host:5432/db) before email regex
    .replace(/[a-zA-Z+]+:\/\/[^:]+:[^@]+@[^\s"']+/gi, "[REDACTED_CONNECTION_STRING]")
    // Redact email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    // Redact Bearer tokens & JWTs
    .replace(/Bearer\s+[A-Za-z0-9-_=.]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\b/g, "[REDACTED_JWT]")
    // Redact Supabase and Paddle API keys by documented prefixes
    .replace(/\b(?:sbp|pdl)_[a-zA-Z0-9_]{8,}\b/gi, "[REDACTED_API_KEY]")
    // Redact explicit OTP / code / secret occurrences
    .replace(/\b(?:otp|code|token|passcode)\s*[:=\s]\s*['"]?(\d{6})['"]?/gi, "code: [REDACTED_OTP]")
    // Redact explicit secret/token fields with delimiter
    .replace(/(?:otp|token|code|password|secret|apikey|key)\s*[:=]\s*["']?[^"'\s,]+["']?/gi, (match) => {
      const parts = match.split(/[:=]/);
      return `${parts[0]}: [REDACTED]`;
    });
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
      body: {
        error: "Step-up authentication required: verification code missing",
        category: "missing_verification_code",
      },
    };
  }

  const stepUpResult = await deps.verifyStepUp(userId, options?.userEmail, otpCode);
  if (!stepUpResult.verified) {
    await deps.logAttempt("unauthorized", sanitizeErrorMessage(stepUpResult.error) ?? "Invalid verification code");
    return {
      status: 401,
      body: {
        error: "Invalid or expired verification code",
        category: "invalid_verification_code",
      },
    };
  }

  // 2. Check rate limit
  const rateLimitCheck = await deps.checkRateLimit(userId);
  if (rateLimitCheck.error) {
    await deps.logAttempt("error", sanitizeErrorMessage(`rate-check failed: ${rateLimitCheck.error}`) ?? "rate-check failed");
    return {
      status: 500,
      body: {
        error: "Rate-limit check failed",
        category: "rate_limit_check_error",
      },
    };
  }

  if (rateLimitCheck.rateLimited) {
    await deps.logAttempt("rate_limited");
    const retryAfter = rateLimitCheck.retryAfterSec ?? 3600;
    return {
      status: 429,
      body: {
        error: "Too many deletion attempts. Try again later.",
        category: "rate_limited",
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
    const sanitizedAuthErr = sanitizeErrorMessage(authErr.message) ?? "unknown_auth_error";
    await deps.logAttempt("error", `auth-deletion-failed: ${sanitizedAuthErr}`);
    return {
      status: 500,
      body: {
        error: "Failed to delete account from authentication service",
        category: "auth_deletion_failure",
      },
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
    await deps.logAttempt("partial_failure", sanitizeErrorMessage(errorMsg) ?? "cleanup_failure");
    return {
      status: 500,
      body: {
        error: "Account deleted, but some associated data could not be removed",
        category: "cleanup_partial_failure",
      },
    };
  }

  // 4. Log successful deletion
  await deps.logAttempt("success");

  return {
    status: 200,
    body: { success: true },
  };
}
