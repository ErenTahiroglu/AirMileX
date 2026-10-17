import { describe, expect, it } from "vitest";
import {
  executeAccountDeletion,
  type AccountDeletionDeps,
} from "./account-deletion.ts";

describe("AirMileX Phase 5B-R3: Account Deletion Invariants & Safety", () => {
  const VALID_USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

  const createMockDeps = (overrides?: Partial<AccountDeletionDeps>): AccountDeletionDeps => {
    return {
      checkRateLimit: async () => ({ rateLimited: false }),
      deleteAuthUser: async () => ({ error: null }),
      deleteCalculationLogs: async () => ({ error: null }),
      deleteSavedMappings: async () => ({ error: null }),
      deleteUserSettings: async () => ({ error: null }),
      logAttempt: async () => {},
      ...overrides,
    };
  };

  it("rejects missing or empty user id with 400 Bad Request", async () => {
    const deps = createMockDeps();
    const res1 = await executeAccountDeletion("", deps);
    expect(res1.status).toBe(400);

    const res2 = await executeAccountDeletion("   ", deps);
    expect(res2.status).toBe(400);
  });

  it("enforces rate-limiting: returns 429 when attempt occurs within cooldown", async () => {
    let loggedStatus = "";
    const deps = createMockDeps({
      checkRateLimit: async () => ({ rateLimited: true, retryAfterSec: 1800 }),
      logAttempt: async (status) => {
        loggedStatus = status;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps);
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

    const res = await executeAccountDeletion(VALID_USER_ID, deps);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Rate-limit check failed");
    expect(loggedStatus).toBe("error");
    expect(loggedError).toContain("rate-check failed: DB connection timeout");
  });

  it("INVARIANT: Auth deletion failure returns 500 and NEVER deletes user_settings or calculation data", async () => {
    let userSettingsDeleted = false;
    let logsDeleted = false;
    let mappingsDeleted = false;
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
      deleteSavedMappings: async () => {
        mappingsDeleted = true;
        return { error: null };
      },
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps);

    // Verify 500 response
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Auth service unavailable");

    // CRITICAL: Financial & user data was NOT deleted
    expect(userSettingsDeleted).toBe(false);
    expect(logsDeleted).toBe(false);
    expect(mappingsDeleted).toBe(false);

    // Verify attempt logged with error
    expect(loggedStatus).toBe("error");
    expect(loggedError).toContain("auth-deletion-failed");
  });

  it("INVARIANT: Successful deletion executes Auth deletion FIRST, then cleans up database rows", async () => {
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

    const res = await executeAccountDeletion(VALID_USER_ID, deps);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify Auth deletion happened before any table deletion
    expect(executionOrder[0]).toBe("auth");
    expect(executionOrder).toContain("logs");
    expect(executionOrder).toContain("mappings");
    expect(executionOrder).toContain("settings");

    expect(loggedStatus).toBe("success");
  });

  it("INVARIANT: Partial database cleanup failure after auth deletion reports failure without misleading success", async () => {
    let loggedStatus = "";
    let loggedError: string | undefined;

    const deps = createMockDeps({
      deleteAuthUser: async () => ({ error: null }),
      deleteCalculationLogs: async () => ({ error: null }),
      deleteSavedMappings: async () => ({ error: new Error("Foreign key lock timeout") }),
      deleteUserSettings: async () => ({ error: null }),
      logAttempt: async (status, err) => {
        loggedStatus = status;
        loggedError = err;
      },
    });

    const res = await executeAccountDeletion(VALID_USER_ID, deps);

    // Must NOT return 200 success
    expect(res.status).toBe(500);
    expect(String(res.body.error)).toContain("saved_mappings: Foreign key lock timeout");
    expect(loggedStatus).toBe("partial_failure");
    expect(loggedError).toContain("Account deleted from Auth, but cleanup failed");
  });
});
