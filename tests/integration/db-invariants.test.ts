import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { SQL } from "bun";
import {
  processPaddleWebhookRequest,
  computeHmacSha256Hex,
} from "../../supabase/functions/_shared/paddle.ts";

async function generatePaddleWebhookSignature(
  rawBody: string,
  secret: string,
  ts: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload = `${ts}:${rawBody}`;
  const h1 = await computeHmacSha256Hex(secret, payload);
  return `ts=${ts};h1=${h1}`;
}

const PG_URL = process.env.DATABASE_URL;

describe("AirMileX Phase 5B: Part E Financial & Database Integration Tests", () => {
  let sql: SQL | null = null;
  let dbAvailable = false;

  beforeAll(async () => {
    if (!PG_URL) {
      dbAvailable = false;
      console.warn("DATABASE_URL not configured. Skipping direct DB tests.");
      return;
    }
    try {
      sql = new SQL(PG_URL);
      // Quick probe
      await sql`SELECT 1 as alive`;
      dbAvailable = true;
    } catch (err) {
      dbAvailable = false;
      if (process.env.CI) {
        throw new Error(
          `Local PostgreSQL database is required in CI when DATABASE_URL is set but failed to connect at ${PG_URL}: ${err}`
        );
      }
      console.warn(`Local PostgreSQL not available at ${PG_URL}. Skipping direct DB tests in local dev.`);
    }
  });

  afterAll(async () => {
    if (sql) {
      await sql.close();
    }
  });

  // Helper to ensure test user exists in auth.users for foreign key constraints
  const createTestUser = async (db: SQL, userId: string) => {
    await db`SET ROLE postgres`;
    await db`SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false)`;
    await db`
      INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
      VALUES (${userId}, 'authenticated', 'authenticated', ${`user_${userId}@test.local`}, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  };

  const cleanupTestUser = async (db: SQL, userId: string) => {
    await db`SET ROLE postgres`;
    await db`SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false)`;
    await db`DELETE FROM public.user_settings WHERE id = ${userId}`;
    await db`DELETE FROM auth.users WHERE id = ${userId}`;
  };

  beforeEach(async () => {
    if (dbAvailable && sql) {
      await sql`SET ROLE postgres`;
      await sql`SELECT set_config('request.jwt.claims', '{"role": "service_role"}', false)`;
    }
  });

  // Helper for skipping if DB is not available in local dev
  const itWithDb = (name: string, fn: (sql: SQL) => Promise<void>) => {
    it(name, async () => {
      if (!dbAvailable || !sql) {
        if (process.env.CI && process.env.DATABASE_URL) {
          throw new Error("PostgreSQL must be running in CI for integration tests");
        }
        return;
      }
      await fn(sql);
    });
  };

  // =========================================================================
  // E1. INITIAL BALANCE INVARIANTS
  // =========================================================================
  describe("E1. Initial Balance Invariants", () => {
    itWithDb("new user receives exactly 50 starting credits by default", async (db) => {
      const testUserId = crypto.randomUUID();
      await createTestUser(db, testUserId);

      // Clean setup in user_settings with authenticated claims
      await db`SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', false)`;
      await db`
        INSERT INTO public.user_settings (id)
        VALUES (${testUserId})
      `;

      const rows = await db`
        SELECT credits FROM public.user_settings WHERE id = ${testUserId}
      `;

      expect(rows.length).toBe(1);
      expect(rows[0].credits).toBe(50);

      // Cleanup
      await cleanupTestUser(db, testUserId);
    });

    itWithDb("unauthorized creation cannot inflate the initial balance past 50", async (db) => {
      const attackerUserId = crypto.randomUUID();
      await createTestUser(db, attackerUserId);

      try {
        // Set claims to authenticated role (simulating user calling via PostgREST)
        await db`SELECT set_config('request.jwt.claims', '{"role": "authenticated"}', false)`;
        await db`INSERT INTO public.user_settings (id, credits) VALUES (${attackerUserId}, 999999)`;

        const rows = await db`
          SELECT credits FROM public.user_settings WHERE id = ${attackerUserId}
        `;

        expect(rows.length).toBe(1);
        expect(rows[0].credits).toBe(50); // Successfully reset to 50 by database trigger
      } finally {
        await cleanupTestUser(db, attackerUserId);
      }
    });

    itWithDb("new user in auth.users automatically receives 50 credits via on_auth_user_created trigger", async (db) => {
      const testUserId = crypto.randomUUID();
      // createTestUser inserts into auth.users without touching public.user_settings
      await createTestUser(db, testUserId);

      // Verify that user_settings was automatically populated by trigger
      const rows = await db`
        SELECT credits FROM public.user_settings WHERE id = ${testUserId}
      `;

      expect(rows.length).toBe(1);
      expect(rows[0].credits).toBe(50);

      await cleanupTestUser(db, testUserId);
    });

    itWithDb("get_settings_flags idempotently initializes 50 credits if user_settings is missing", async (db) => {
      const testUserId = crypto.randomUUID();
      await createTestUser(db, testUserId);
      // Explicitly delete user_settings row to simulate a legacy/uninitialized state
      await db`DELETE FROM public.user_settings WHERE id = ${testUserId}`;

      // Simulate authenticated caller requesting flags
      await db`SET ROLE authenticated`;
      await db`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: testUserId, role: "authenticated" })}, false)`;

      const rows = await db`
        SELECT * FROM public.get_settings_flags(${testUserId})
      `;

      expect(rows.length).toBe(1);
      expect(rows[0].credits).toBe(50);
      expect(rows[0].has_pat).toBe(false);

      await cleanupTestUser(db, testUserId);
    });

    itWithDb("repeated get_settings_flags and login events never re-grant 50 credits to existing balance", async (db) => {
      const testUserId = crypto.randomUUID();
      await createTestUser(db, testUserId);

      // Simulate user spending 30 credits (balance 20)
      await db`SET ROLE service_role`;
      await db`SELECT public.reserve_credits(${testUserId}, 30)`;

      // User logs in again / refreshes page multiple times
      await db`SET ROLE authenticated`;
      await db`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: testUserId, role: "authenticated" })}, false)`;

      for (let i = 0; i < 3; i++) {
        const rows = await db`SELECT credits FROM public.get_settings_flags(${testUserId})`;
        expect(rows.length).toBe(1);
        expect(rows[0].credits).toBe(20); // NOT reset to 50
      }

      await cleanupTestUser(db, testUserId);
    });

    itWithDb("purchased credits > 50 are strictly preserved across get_settings_flags calls", async (db) => {
      const testUserId = crypto.randomUUID();
      await createTestUser(db, testUserId);

      // Give user 550 credits as service_role (simulating Paddle fulfillment)
      await db`SET ROLE service_role`;
      await db`UPDATE public.user_settings SET credits = 550 WHERE id = ${testUserId}`;

      // User requests flags as authenticated
      await db`SET ROLE authenticated`;
      await db`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: testUserId, role: "authenticated" })}, false)`;

      const rows = await db`SELECT credits FROM public.get_settings_flags(${testUserId})`;
      expect(rows.length).toBe(1);
      expect(rows[0].credits).toBe(550); // Preserved intact

      await cleanupTestUser(db, testUserId);
    });

    itWithDb("concurrent get_settings_flags calls idempotently resolve without race conditions", async (db) => {
      const testUserId = crypto.randomUUID();
      await createTestUser(db, testUserId);
      await db`DELETE FROM public.user_settings WHERE id = ${testUserId}`;

      // Concurrently call get_settings_flags 5 times across distinct connections
      const results = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const client = new SQL(PG_URL!);
          try {
            await client`SET ROLE authenticated`;
            await client`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: testUserId, role: "authenticated" })}, false)`;
            const [row] = await client`SELECT credits FROM public.get_settings_flags(${testUserId})`;
            return row.credits;
          } finally {
            await client.close();
          }
        })
      );

      for (const balance of results) {
        expect(balance).toBe(50);
      }

      const [finalRow] = await db`SELECT credits FROM public.user_settings WHERE id = ${testUserId}`;
      expect(finalRow.credits).toBe(50);

      await cleanupTestUser(db, testUserId);
    });
  });

  // =========================================================================
  // E2. CREDIT RESERVATION & REFUND INVARIANTS
  // =========================================================================
  describe("E2. Credit Reservation & Refund Invariants", () => {
    itWithDb("reservation reduces available credits atomically", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Reserve 10 credits as service_role
      await db`SET ROLE service_role`;
      const [res] = await db`
        SELECT public.reserve_credits(${userId}, 10) as new_balance
      `;
      expect(res.new_balance).toBe(40);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(40);

      await cleanupTestUser(db, userId);
    });

    itWithDb("insufficient balance cannot become negative", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Try to reserve 60 credits when only 50 are available
      await db`SET ROLE service_role`;
      let failed = false;
      try {
        await db`SELECT public.reserve_credits(${userId}, 60)`;
      } catch (err: any) {
        failed = true;
        expect(err.message).toContain("Insufficient credits");
      }
      expect(failed).toBe(true);

      // Verify balance was NOT modified and remains 50
      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(50);

      await cleanupTestUser(db, userId);
    });

    itWithDb("successful refund restores the correct amount", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Reserve 20
      await db`SET ROLE service_role`;
      await db`SELECT public.reserve_credits(${userId}, 20)`;

      // Refund 15
      const [res] = await db`SELECT public.refund_credits(${userId}, 15) as new_balance`;
      expect(res.new_balance).toBe(45);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(45);

      await cleanupTestUser(db, userId);
    });

    itWithDb("concurrent reservations preserve balance integrity without race condition", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Run 5 parallel reservations of 10 credits each (total 50).
      // Each parallel worker must use its own connection and set service_role so
      // the prevent_credits_tampering trigger permits the atomic balance deduction.
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, async () => {
          const client = new SQL(PG_URL!);
          try {
            await client`SET ROLE service_role`;
            return await client`SELECT public.reserve_credits(${userId}, 10)`;
          } finally {
            await client.close();
          }
        })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      expect(succeeded).toBe(5);

      await db`SET ROLE service_role`;
      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(0);

      // 6th attempt must fail
      let failedSixth = false;
      try {
        await db`SELECT public.reserve_credits(${userId}, 10)`;
      } catch {
        failedSixth = true;
      }
      expect(failedSixth).toBe(true);

      await cleanupTestUser(db, userId);
    });

    itWithDb("negative credit reservation is rejected and cannot inflate balance", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);

      await db`SET ROLE service_role`;
      let errorThrown = false;
      try {
        await db`SELECT public.reserve_credits(${userId}, -10)`;
      } catch (err: any) {
        errorThrown = true;
        expect(err.message).toContain("Invalid reservation amount");
      }
      expect(errorThrown).toBe(true);

      // Verify credits were NOT increased from 50 to 60
      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(50);

      await cleanupTestUser(db, userId);
    });

    itWithDb("zero and null credit reservations are rejected with clear exception", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);

      await db`SET ROLE service_role`;

      // Zero
      let zeroFailed = false;
      try {
        await db`SELECT public.reserve_credits(${userId}, 0)`;
      } catch (err: any) {
        zeroFailed = true;
        expect(err.message).toContain("Invalid reservation amount");
      }
      expect(zeroFailed).toBe(true);

      // Null
      let nullFailed = false;
      try {
        await db`SELECT public.reserve_credits(${userId}, null)`;
      } catch (err: any) {
        nullFailed = true;
        expect(err.message).toContain("Invalid reservation amount");
      }
      expect(nullFailed).toBe(true);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(50);

      await cleanupTestUser(db, userId);
    });

    itWithDb("database-level constraint blocks direct updates that would make credits negative", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);

      await db`SET ROLE service_role`;
      let constraintTriggered = false;
      try {
        await db`UPDATE public.user_settings SET credits = -5 WHERE id = ${userId}`;
      } catch (err: any) {
        constraintTriggered = true;
        expect(err.message).toContain("user_settings_credits_nonnegative");
      }
      expect(constraintTriggered).toBe(true);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(50);

      await cleanupTestUser(db, userId);
    });
  });

  // =========================================================================
  // E3. PADDLE CREDIT FULFILLMENT INVARIANTS
  // =========================================================================
  describe("E3. Paddle Credit Fulfillment Invariants (Real PostgreSQL RPC)", () => {
    itWithDb("first valid transaction grants exactly 500 credits", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Call fulfill_paddle_credits as service_role
      await db`SET ROLE service_role`;
      const [res] = await db`
        SELECT public.fulfill_paddle_credits('evt_1', 'txn_1', ${userId}, 500) as outcome
      `;

      expect(res.outcome.success).toBe(true);
      expect(res.outcome.duplicate).toBe(false);
      expect(res.outcome.credits_added).toBe(500);
      expect(res.outcome.balance).toBe(550);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(550);

      // Cleanup
      await db`DELETE FROM public.processed_paddle_events WHERE id = 'evt_1'`;
      await cleanupTestUser(db, userId);
    });

    itWithDb("identical webhook redelivery does not grant credits again", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Initial fulfillment
      await db`SET ROLE service_role`;
      await db`SELECT public.fulfill_paddle_credits('evt_redelivery', 'txn_redelivery', ${userId}, 500)`;

      // Redeliver identical event
      const [retryRes] = await db`
        SELECT public.fulfill_paddle_credits('evt_redelivery', 'txn_redelivery', ${userId}, 500) as outcome
      `;

      expect(retryRes.outcome.success).toBe(true);
      expect(retryRes.outcome.duplicate).toBe(true);
      expect(retryRes.outcome.credits_added).toBe(0);
      expect(retryRes.outcome.balance).toBe(550);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(550);

      await db`DELETE FROM public.processed_paddle_events WHERE id = 'evt_redelivery'`;
      await cleanupTestUser(db, userId);
    });

    itWithDb("same transaction ID under a different event ID does not grant credits again", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      await db`SET ROLE service_role`;
      await db`SELECT public.fulfill_paddle_credits('evt_orig', 'txn_shared', ${userId}, 500)`;

      // Different event ID, identical transaction ID
      const [retryRes] = await db`
        SELECT public.fulfill_paddle_credits('evt_new_id', 'txn_shared', ${userId}, 500) as outcome
      `;

      expect(retryRes.outcome.success).toBe(true);
      expect(retryRes.outcome.duplicate).toBe(true);
      expect(retryRes.outcome.credits_added).toBe(0);

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(550);

      await db`DELETE FROM public.processed_paddle_events WHERE transaction_id = 'txn_shared'`;
      await cleanupTestUser(db, userId);
    });

    itWithDb("two distinct completed purchases grant exactly 1,000 credits", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      // Purchase 1
      await db`SET ROLE service_role`;
      await db`SELECT public.fulfill_paddle_credits('evt_p1', 'txn_p1', ${userId}, 500)`;

      // Purchase 2
      await db`SELECT public.fulfill_paddle_credits('evt_p2', 'txn_p2', ${userId}, 500)`;

      const [row] = await db`SELECT credits FROM public.user_settings WHERE id = ${userId}`;
      expect(row.credits).toBe(1050); // 50 initial + 500 + 500

      await db`DELETE FROM public.processed_paddle_events WHERE transaction_id IN ('txn_p1', 'txn_p2')`;
      await cleanupTestUser(db, userId);
    });

    itWithDb("unauthorized roles cannot call privileged fulfillment or reservation RPCs", async (db) => {
      const userId = crypto.randomUUID();
      await createTestUser(db, userId);
      await db`INSERT INTO public.user_settings (id) VALUES (${userId})`;

      try {
        // Attempt fulfill_paddle_credits as anon
        await db`SET ROLE anon`;
        let anonFulfillBlocked = false;
        try {
          await db`SELECT public.fulfill_paddle_credits('evt_unauth', 'txn_unauth', ${userId}, 500)`;
        } catch (err: any) {
          anonFulfillBlocked = true;
        }
        expect(anonFulfillBlocked).toBe(true);

        // Attempt fulfill_paddle_credits as authenticated
        await db`SET ROLE authenticated`;
        let authFulfillBlocked = false;
        try {
          await db`SELECT public.fulfill_paddle_credits('evt_unauth', 'txn_unauth', ${userId}, 500)`;
        } catch (err: any) {
          authFulfillBlocked = true;
        }
        expect(authFulfillBlocked).toBe(true);

        // Attempt reserve_credits as authenticated
        let authReserveBlocked = false;
        try {
          await db`SELECT public.reserve_credits(${userId}, 10)`;
        } catch (err: any) {
          authReserveBlocked = true;
        }
        expect(authReserveBlocked).toBe(true);
      } finally {
        await db`SET ROLE postgres`;
        await cleanupTestUser(db, userId);
      }
    });

    itWithDb("failed fulfillment does not leave a committed purchase event without balance update", async (db) => {
      const nonExistentUserId = crypto.randomUUID();

      await db`SET ROLE service_role`;
      let failed = false;
      try {
        await db`SELECT public.fulfill_paddle_credits('evt_orphan_check', 'txn_orphan_check', ${nonExistentUserId}, 500)`;
      } catch (err: any) {
        failed = true;
        expect(err.message).toContain("User settings not found");
      }
      expect(failed).toBe(true);

      // Verify transaction was rolled back and no row exists in processed_paddle_events
      await db`SET ROLE postgres`;
      const rows = await db`
        SELECT * FROM public.processed_paddle_events WHERE transaction_id = 'txn_orphan_check'
      `;
      expect(rows.length).toBe(0);
    });
  });

  // =========================================================================
  // E4. SIGNED WEBHOOK INTEGRATION
  // =========================================================================
  describe("E4. Signed Webhook Integration (processPaddleWebhookRequest)", () => {
    const SECRET = "pdl_ntfset_01h8abcdef1234567890abcdef12";
    const PRICE_ID = "pri_01h8testprice1234567890123";
    const USER_ID = "00000000-0000-4000-a000-000000000001";

    const createPayload = (overrides: Record<string, any> = {}) =>
      JSON.stringify({
        event_id: "evt_webhook_test_1",
        event_type: "transaction.completed",
        occurred_at: new Date().toISOString(),
        data: {
          id: "txn_webhook_test_1",
          status: "completed",
          items: [
            {
              price: { id: PRICE_ID },
              quantity: 1,
            },
          ],
          custom_data: {
            user_id: USER_ID,
          },
        },
        ...overrides,
      });

    it("E4.1: accepts valid signature + valid transaction and calls fulfillment RPC", async () => {
      const payload = createPayload();
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, timestamp);

      const fulfillRpc = vi.fn(async () => ({
        data: { success: true, duplicate: false, credits_added: 500, balance: 550 },
        error: null,
      }));

      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.duplicate).toBe(false);
      expect(response.body.credits_added).toBe(500);
      expect(fulfillRpc).toHaveBeenCalledTimes(1);
    });

    it("E4.2: rejects invalid signature with 401 without fulfilling credits", async () => {
      const payload = createPayload();
      const currentTs = Math.floor(Date.now() / 1000);
      const fakeSignature = `ts=${currentTs};h1=0000000000000000000000000000000000000000000000000000000000000000`;

      const fulfillRpc = vi.fn();
      const response = await processPaddleWebhookRequest("POST", payload, fakeSignature, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Signature mismatch");
      expect(fulfillRpc).not.toHaveBeenCalled();
    });

    it("E4.3: rejects expired timestamp (>300s in past) with 401", async () => {
      const payload = createPayload();
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, expiredTimestamp);

      const fulfillRpc = vi.fn();
      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Signature timestamp expired");
      expect(fulfillRpc).not.toHaveBeenCalled();
    });

    it("E4.4: rejects wrong price ID with 400", async () => {
      const payload = createPayload({
        data: {
          id: "txn_wrong_price",
          status: "completed",
          items: [{ price: { id: "pri_wrong_product_id" }, quantity: 1 }],
          custom_data: { user_id: USER_ID },
        },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, timestamp);

      const fulfillRpc = vi.fn();
      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid price_id");
      expect(fulfillRpc).not.toHaveBeenCalled();
    });

    it("E4.5: rejects quantity other than 1 with 400", async () => {
      const payload = createPayload({
        data: {
          id: "txn_wrong_qty",
          status: "completed",
          items: [{ price: { id: PRICE_ID }, quantity: 5 }],
          custom_data: { user_id: USER_ID },
        },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, timestamp);

      const fulfillRpc = vi.fn();
      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid item quantity");
      expect(fulfillRpc).not.toHaveBeenCalled();
    });

    it("E4.6: handles duplicate delivery idempotently with status 200 and duplicate=true", async () => {
      const payload = createPayload();
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, timestamp);

      const fulfillRpc = vi.fn(async () => ({
        data: { success: true, duplicate: true, credits_added: 0, balance: 550 },
        error: null,
      }));

      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(200);
      expect(response.body.duplicate).toBe(true);
      expect(response.body.credits_added).toBe(0);
    });

    it("E4.7: safely ignores non-completed events with status 200 without credit fulfillment", async () => {
      const payload = createPayload({
        event_type: "transaction.updated",
        data: {
          id: "txn_draft",
          status: "draft",
          items: [{ price: { id: PRICE_ID }, quantity: 1 }],
          custom_data: { user_id: USER_ID },
        },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, timestamp);

      const fulfillRpc = vi.fn();
      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(200);
      expect(response.body.ignored).toBe(true);
      expect(fulfillRpc).not.toHaveBeenCalled();
    });

    it("E4.8: returns 500 when database fulfillment RPC fails", async () => {
      const payload = createPayload();
      const timestamp = Math.floor(Date.now() / 1000);
      const signatureHeader = await generatePaddleWebhookSignature(payload, SECRET, timestamp);

      const fulfillRpc = vi.fn(async () => ({
        data: null,
        error: { message: "connection to server at '127.0.0.1' failed" },
      }));

      const response = await processPaddleWebhookRequest("POST", payload, signatureHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc,
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain("Credit fulfillment database failure");
    });
  });
});
