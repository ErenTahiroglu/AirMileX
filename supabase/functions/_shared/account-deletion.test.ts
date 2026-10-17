import { describe, expect, it } from "vitest";
import {
  executeAccountDeletion,
  type AccountDeletionDeps,
  type StepUpAuthOptions,
} from "./account-deletion.ts";

describe("AirMileX Phase 5B-R4: Account Deletion Step-Up & Safety Invariants", () => {
  const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
  const VALID_USER_EMAIL = "user@example.com";
  const VALID_OTP_CODE = "123456";

  const defaultStepUpOptions: StepUpAuthOptions = {
    userEmail: VALID_USER_EMAIL,
    otpCode: VALID_OTP_CODE,
  };

  const createMockDeps = (overrides?: Partial<AccountDeletionDeps>): AccountDeletionDeps => {
    return {
      verifyStepUp: async (_uid, _email, code) => {
        if (code === VALID_OTP_CODE) return { verified: true };
        return { verified: false, error: "Invalid verification code" };
      },
      checkRateLimit: async () => ({ rateLimited: false }),
      deleteAuthUser: async () => ({ error: null }),
      deleteCalculationLogs: async () => ({ error: null }),
      deleteSavedAddressPairs: async () => ({ error: null }),
      deleteSavedMappings: async () => ({ error: null }),
      deleteUserSettings: async () => ({ error: null }),
      logAttempt: async () => {},
      ...overrides,
    };
  };

  // -------------------------------------------------------------------------
  // Input & Step-Up Negative Tests
  // -------------------------------------------------------------------------
  it("rejects missing or empty user id with 400 Bad Request", async () => {
    const deps = createMockDeps();
    const res1 = await executeAccountDeletion("", deps, defaultStepUpOptions);
    expect(res1.status).toBe(400);

    const res2 = await executeAccountDeletion("   ", deps, defaultStepUpOptions);
    expect(res2.status).toBe(400);
  });

  it("TASK A NEGATIVE: rejects direct deletion request without step-up options with 401 Unauthorized", async () => {
    let authDeleted = false;
    let tablesDeleted = false;
    const deps = createMockDeps({
      deleteAuthUser: async () => {
        authDeleted = true;
        return { error: null };
      },
      deleteUserSettings: async () => {
        tablesDeleted = true;
        return { error: null };
      },
    });

    // Caller makes direct call without options/body
    const res = await executeAccountDeletion(VALID_USER_ID, deps);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("verification code missing");
    expect(authDeleted).toBe(false);
    expect(tablesDeleted).toBe(false);
  });

  it("TASK A NEGATIVE: rejects direct deletion request with blank or whitespace otp_code with 401 Unauthorized", async () => {
    const deps = createMockDeps();
    const res = await executeAccountDeletion(VALID_USER_ID, deps, {
      userEmail: VALID_USER_EMAIL,
      otpCode: "   ",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("verification code missing");
  });

  it("TASK A NEGATIVE: rejects deletion when step-up verification fails (invalid code) with 401 and logs unauthorized", async () => {
    let loggedStatus = "";
    let loggedError: string | undefined;
    let authDeleted = false;

    const deps = createMockDeps({
      deleteAuthUser: async () => {
        authDeleted = true;
        return { error: null };
      },
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, {
      userEmail: VALID_USER_EMAIL,
      otpCode: "000000", // Wrong code
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired verification code");
    expect(authDeleted).toBe(false);
    expect(loggedStatus).toBe("unauthorized");
    expect(loggedError).toBe("Invalid verification code");
  });

  it("TASK A NEGATIVE: rejects deletion when step-up code is expired or replayed with 401 Unauthorized", async () => {
    let authDeleted = false;
    const deps = createMockDeps({
      verifyStepUp: async () => ({
        verified: false,
        error: "Token has expired or is invalid",
      }),
      deleteAuthUser: async () => {
        authDeleted = true;
        return { error: null };
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired verification code");
    expect(authDeleted).toBe(false);
  });

  it("TASK A NEGATIVE: rejects deletion when step-up authorization belongs to a different user", async () => {
    let authDeleted = false;
    const deps = createMockDeps({
      verifyStepUp: async () => ({
        verified: false,
        error: "User ID mismatch during verification",
      }),
      deleteAuthUser: async () => {
        authDeleted = true;
        return { error: null };
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired verification code");
    expect(authDeleted).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Rate Limiting Tests
  // -------------------------------------------------------------------------
  it("enforces rate-limiting: returns 429 when attempt occurs within cooldown", async () => {
    let loggedStatus = "";
    const deps = createMockDeps({
      checkRateLimit: async () => ({ rateLimited: true, retryAfterSec: 1800 }),
      logAttempt: async (status) => {
        loggedStatus = status;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);
    expect(res.status).toBe(429);
    expect(res.body.retry_after_seconds).toBe(1800);
    expect(res.headers?.["Retry-After"]).toBe("1800");
    expect(loggedStatus).toBe("rate_limited");
  });

  it("handles rate-limit check failure gracefully with 500 error", async () => {
    let loggedStatus = "";
    let loggedError: string | undefined;
    const deps = createMockDeps({
      checkRateLimit: async () => ({ rateLimited: false, error: "DB connection timeout" }),
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Rate-limit check failed");
    expect(loggedStatus).toBe("error");
    expect(loggedError).toContain("rate-check failed: DB connection timeout");
  });

  // -------------------------------------------------------------------------
  // Invariant & Deletion Sequencing Tests
  // -------------------------------------------------------------------------
  it("INVARIANT: Auth deletion failure returns 500 and NEVER deletes user_settings, address pairs, or calculation data", async () => {
    let userSettingsDeleted = false;
    let logsDeleted = false;
    let mappingsDeleted = false;
    let addressPairsDeleted = false;
    let loggedStatus = "";
    let loggedError: string | undefined;

    const deps = createMockDeps({
      deleteAuthUser: async () => ({ error: new Error("Auth service unavailable") }),
      deleteUserSettings: async () => {
        userSettingsDeleted = true;
        return { error: null };
      },
      deleteCalculationLogs: async () => {
        logsDeleted = true;
        return { error: null };
      },
      deleteSavedAddressPairs: async () => {
        addressPairsDeleted = true;
        return { error: null };
      },
      deleteSavedMappings: async () => {
        mappingsDeleted = true;
        return { error: null };
      },
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);

    // Verify 500 response
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete account from authentication service");
    expect(res.body.category).toBe("auth_deletion_failure");
    expect(JSON.stringify(res.body)).not.toContain("Auth service unavailable");

    // CRITICAL: Financial, address & user data was NOT deleted
    expect(userSettingsDeleted).toBe(false);
    expect(logsDeleted).toBe(false);
    expect(mappingsDeleted).toBe(false);
    expect(addressPairsDeleted).toBe(false);

    // Verify attempt logged with error
    expect(loggedStatus).toBe("error");
    expect(loggedError).toContain("auth-deletion-failed");
  });

  it("INVARIANT: Successful deletion executes Auth deletion FIRST, then cleans up database rows including saved_address_pairs", async () => {
    const executionOrder: string[] = [];
    let loggedStatus = "";

    const deps = createMockDeps({
      deleteAuthUser: async () => {
        executionOrder.push("auth");
        return { error: null };
      },
      deleteCalculationLogs: async () => {
        executionOrder.push("logs");
        return { error: null };
      },
      deleteSavedAddressPairs: async () => {
        executionOrder.push("address_pairs");
        return { error: null };
      },
      deleteSavedMappings: async () => {
        executionOrder.push("mappings");
        return { error: null };
      },
      deleteUserSettings: async () => {
        executionOrder.push("settings");
        return { error: null };
      },
      logAttempt: async (status) => {
        loggedStatus = status;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify Auth deletion happened before any table deletion
    expect(executionOrder[0]).toBe("auth");
    expect(executionOrder).toContain("logs");
    expect(executionOrder).toContain("address_pairs");
    expect(executionOrder).toContain("mappings");
    expect(executionOrder).toContain("settings");

    expect(loggedStatus).toBe("success");
  });

  it("INVARIANT: Partial database cleanup failure on saved_address_pairs reports failure without misleading success", async () => {
    let loggedStatus = "";
    let loggedError: string | undefined;

    const deps = createMockDeps({
      deleteAuthUser: async () => ({ error: null }),
      deleteCalculationLogs: async () => ({ error: null }),
      deleteSavedAddressPairs: async () => ({ error: new Error("Address pairs table locked") }),
      deleteSavedMappings: async () => ({ error: null }),
      deleteUserSettings: async () => ({ error: null }),
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);

    // Must NOT return 200 success
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Account deleted, but some associated data could not be removed");
    expect(res.body.category).toBe("cleanup_partial_failure");
    expect(JSON.stringify(res.body)).not.toContain("Address pairs table locked");
    expect(loggedStatus).toBe("partial_failure");
    expect(loggedError).toContain("Account deleted from Auth, but cleanup failed");
  });

  it("INVARIANT: Partial database cleanup failure after auth deletion reports failure without misleading success", async () => {
    let loggedStatus = "";
    let loggedError: string | undefined;

    const deps = createMockDeps({
      deleteAuthUser: async () => ({ error: null }),
      deleteCalculationLogs: async () => ({ error: null }),
      deleteSavedAddressPairs: async () => ({ error: null }),
      deleteSavedMappings: async () => ({ error: new Error("Foreign key lock timeout") }),
      deleteUserSettings: async () => ({ error: null }),
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);

    // Must NOT return 200 success
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Account deleted, but some associated data could not be removed");
    expect(res.body.category).toBe("cleanup_partial_failure");
    expect(JSON.stringify(res.body)).not.toContain("Foreign key lock timeout");
    expect(loggedStatus).toBe("partial_failure");
    expect(loggedError).toContain("Account deleted from Auth, but cleanup failed");
  });

  // -------------------------------------------------------------------------
  // Phase B Correctness & Security Hygiene Tests
  // -------------------------------------------------------------------------
  describe("B1 & B2: Secret-safe error redaction & OTP usability", () => {
    it("TASK B2: sanitizeErrorMessage redacts emails, tokens, secrets, and connection strings", async () => {
      const { sanitizeErrorMessage } = await import("./account-deletion.ts");

      // Email canary
      expect(sanitizeErrorMessage("Error for test.user+tag@domain.co.uk: timeout")).toBe(
        "Error for [REDACTED_EMAIL]: timeout"
      );

      // Bearer token canary
      expect(
        sanitizeErrorMessage("Failed request with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID5_real_jwt_secret")
      ).toContain("Bearer [REDACTED_TOKEN]");

      // Standalone JWT canary
      expect(
        sanitizeErrorMessage("Token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.abcdef123456 expired")
      ).toBe("Token [REDACTED_JWT] expired");

      // Database connection string canary
      expect(
        sanitizeErrorMessage("DB error: postgres://postgres:SecretPass123!@db.project.supabase.co:5432/postgres failed")
      ).toBe("DB error: [REDACTED_CONNECTION_STRING] failed");

      // API key / secret canary
      expect(
        sanitizeErrorMessage("Failed with apikey: sbp_live_secret_key_99999 and password: MyPassword")
      ).toContain("[REDACTED]");

      // Max length truncation
      const longMessage = "A".repeat(800);
      expect(sanitizeErrorMessage(longMessage)?.length).toBe(500);

      // OTP code canary
      expect(sanitizeErrorMessage("Error verifying otp: 482910 for account")).toContain("[REDACTED");

      // Null/empty handling
      expect(sanitizeErrorMessage(null)).toBeNull();
      expect(sanitizeErrorMessage(undefined)).toBeNull();
      expect(sanitizeErrorMessage("")).toBeNull();
    });

    it("TASK B1: prior failed OTP attempt does not block subsequent legitimate deletion with correct code", async () => {
      // User attempts deletion with mistyped code -> gets 401
      const deps = createMockDeps();
      const firstRes = await executeAccountDeletion(VALID_USER_ID, deps, {
        userEmail: VALID_USER_EMAIL,
        otpCode: "999999", // Wrong code
      });
      expect(firstRes.status).toBe(401);

      // User immediately enters correct code -> passes step-up and succeeds (no 1-hour 429 lockout)
      const secondRes = await executeAccountDeletion(VALID_USER_ID, deps, defaultStepUpOptions);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.success).toBe(true);
    });

    it("TASK A CANARY: database and auth exceptions never leak credentials, JWTs, or emails to client body or audit logs", async () => {
      const sensitiveSecret = "sbp_live_supersecret_admin_key_12345";
      const sensitiveConnStr = "postgres://postgres:SuperSecretP@ssword@db.xyz.supabase.co:5432/postgres";
      const sensitiveEmail = "victim.private+test@example.com";
      const sensitiveJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.abcdef1234567890";
      const sensitiveOtp = "729104";

      let loggedStatus = "";
      let loggedError: string | undefined;

      const deps = createMockDeps({
        verifyStepUp: async () => ({ verified: true }),
        deleteAuthUser: async () => ({
          error: new Error(`Internal Auth DB crash: ${sensitiveConnStr} using key ${sensitiveSecret} for ${sensitiveEmail} token=${sensitiveJwt} otp=${sensitiveOtp}`),
        }),
        logAttempt: async (status, err) => {
          loggedStatus = status;
          loggedError = err;
        },
      });

      const res = await executeAccountDeletion(VALID_USER_ID, deps, {
        userEmail: sensitiveEmail,
        otpCode: sensitiveOtp,
      });

      // 1. Check HTTP response body
      expect(res.status).toBe(500);
      expect(res.body.category).toBe("auth_deletion_failure");
      const bodyJson = JSON.stringify(res.body);
      expect(bodyJson).not.toContain(sensitiveSecret);
      expect(bodyJson).not.toContain(sensitiveConnStr);
      expect(bodyJson).not.toContain(sensitiveEmail);
      expect(bodyJson).not.toContain(sensitiveJwt);
      expect(bodyJson).not.toContain(sensitiveOtp);

      // 2. Check server audit log
      expect(loggedStatus).toBe("error");
      expect(loggedError).toBeDefined();
      expect(loggedError).not.toContain(sensitiveSecret);
      expect(loggedError).not.toContain(sensitiveConnStr);
      expect(loggedError).not.toContain(sensitiveEmail);
      expect(loggedError).not.toContain(sensitiveJwt);
      expect(loggedError).not.toContain(sensitiveOtp);
      expect(loggedError).toContain("[REDACTED_CONNECTION_STRING]");
      expect(loggedError).toContain("[REDACTED_EMAIL]");
    });
  });
});
