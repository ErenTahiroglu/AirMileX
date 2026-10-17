import { describe, expect, it, vi } from "vitest";
import {
  computeHmacSha256Hex,
  createPaddleCheckoutTransaction,
  processPaddleWebhookRequest,
  resolvePaddleApiHost,
  timingSafeEqual,
  validatePaddleCredentials,
  validatePaddleWebhookPayload,
  verifyPaddleSignature,
  PADDLE_API_HOSTS,
  type PaddleFulfillmentRpcResponse,
} from "./paddle.ts";

const SECRET = "pdl_ntfset_01h84testsecretkey123456789";
const PRICE_ID = "pri_01h8444a7qzp7k7pkv1k8cgn";
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

async function createSignatureHeader(
  secret: string,
  rawBody: string,
  ts: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload = `${ts}:${rawBody}`;
  const h1 = await computeHmacSha256Hex(secret, payload);
  return `ts=${ts};h1=${h1}`;
}

function buildTransactionPayload(overrides?: {
  eventType?: string;
  eventId?: string;
  transactionId?: string;
  status?: string;
  userId?: string | null;
  priceId?: string;
  quantity?: number;
  items?: any[];
}) {
  const eventType = overrides?.eventType ?? "transaction.completed";
  const eventId = overrides?.eventId ?? "evt_test_001";
  const transactionId = overrides?.transactionId ?? "txn_test_001";
  const status = overrides?.status ?? "completed";
  const userId = overrides?.userId !== undefined ? overrides.userId : USER_ID;
  const priceId = overrides?.priceId ?? PRICE_ID;
  const quantity = overrides?.quantity ?? 1;

  const items =
    overrides?.items !== undefined
      ? overrides.items
      : [
          {
            price: { id: priceId },
            quantity,
          },
        ];

  return JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    data: {
      id: transactionId,
      status,
      customer_id: "ctm_01h84",
      custom_data: userId ? { user_id: userId } : {},
      items,
    },
  });
}

/**
 * In-memory simulated PostgreSQL repository.
 * Emulates the constraints and atomic RPC logic of fulfill_paddle_credits:
 * - Primary key on processed_paddle_events(id)
 * - Unique index on processed_paddle_events(transaction_id)
 * - Atomic user credit increment
 * - Rollback on simulated DB failure
 */
class MockPostgresDatabase {
  public userCredits = new Map<string, number>();
  public processedEvents = new Map<string, { transactionId: string; userId: string; credits: number }>();
  public processedTransactions = new Set<string>();
  public simulateFailure = false;

  constructor() {
    this.userCredits.set(USER_ID, 0);
  }

  // Simulates Postgres fulfill_paddle_credits RPC
  public async fulfillPaddleCredits(params: {
    eventId: string;
    transactionId: string;
    userId: string;
    credits: number;
  }): Promise<{ data: PaddleFulfillmentRpcResponse | null; error: any }> {
    if (this.simulateFailure) {
      return { data: null, error: new Error("Simulated PostgreSQL connection failure") };
    }

    // Fast-path duplicate check
    if (this.processedEvents.has(params.eventId) || this.processedTransactions.has(params.transactionId)) {
      const balance = this.userCredits.get(params.userId) ?? 0;
      return {
        data: {
          success: true,
          duplicate: true,
          credits_added: 0,
          balance,
        },
        error: null,
      };
    }

    // Simulate atomic insertion with UNIQUE constraint check
    if (this.processedEvents.has(params.eventId) || this.processedTransactions.has(params.transactionId)) {
      // Caught unique_violation in subtransaction
      const balance = this.userCredits.get(params.userId) ?? 0;
      return {
        data: {
          success: true,
          duplicate: true,
          credits_added: 0,
          balance,
        },
        error: null,
      };
    }

    // Atomically insert event and transaction ID
    this.processedEvents.set(params.eventId, {
      transactionId: params.transactionId,
      userId: params.userId,
      credits: params.credits,
    });
    this.processedTransactions.add(params.transactionId);

    // Atomically update user balance
    const currentBalance = this.userCredits.get(params.userId) ?? 0;
    const newBalance = currentBalance + params.credits;
    this.userCredits.set(params.userId, newBalance);

    return {
      data: {
        success: true,
        duplicate: false,
        credits_added: params.credits,
        balance: newBalance,
      },
      error: null,
    };
  }
}

describe("AirMileX Phase 1B: Paddle Payment Integrity", () => {
  describe("Utility & Signature Verification", () => {
    it("timingSafeEqual correctly compares identical and mismatched strings", () => {
      expect(timingSafeEqual("abc", "abc")).toBe(true);
      expect(timingSafeEqual("abc", "abd")).toBe(false);
      expect(timingSafeEqual("abc", "abcd")).toBe(false);
      expect(timingSafeEqual("", "")).toBe(true);
    });

    it("verifies authentic signature with valid timestamp", async () => {
      const rawBody = buildTransactionPayload();
      const now = 1700000000;
      const header = await createSignatureHeader(SECRET, rawBody, now);

      const res = await verifyPaddleSignature(rawBody, header, SECRET, {
        currentTimestamp: now,
        toleranceSeconds: 300,
      });

      expect(res.valid).toBe(true);
    });
  });

  describe("Requirement 1: Valid purchase grants 500 credits", () => {
    it("successfully validates, invokes RPC, increments balance by 500, and returns 200", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({
        eventId: "evt_valid_1",
        transactionId: "txn_valid_1",
      });
      const header = await createSignatureHeader(SECRET, rawBody);

      const response = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        duplicate: false,
        credits_added: 500,
        balance: 500,
      });
      expect(db.userCredits.get(USER_ID)).toBe(500);
      expect(db.processedTransactions.has("txn_valid_1")).toBe(true);
    });
  });

  describe("Requirement 2: Duplicate event/transaction grants zero extra credits", () => {
    it("grants zero extra credits on repeated event ID", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({
        eventId: "evt_dup_1",
        transactionId: "txn_dup_1",
      });
      const header = await createSignatureHeader(SECRET, rawBody);

      // First call
      const res1 = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });
      expect(res1.status).toBe(200);
      expect(res1.body.credits_added).toBe(500);
      expect(res1.body.duplicate).toBe(false);

      // Duplicate call with exact same event & transaction
      const res2 = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });
      expect(res2.status).toBe(200);
      expect(res2.body.duplicate).toBe(true);
      expect(res2.body.credits_added).toBe(0);
      expect(res2.body.balance).toBe(500);
      expect(db.userCredits.get(USER_ID)).toBe(500);
    });

    it("grants zero extra credits when same transaction is sent under a new event ID", async () => {
      const db = new MockPostgresDatabase();
      const rawBody1 = buildTransactionPayload({
        eventId: "evt_original",
        transactionId: "txn_shared_123",
      });
      const header1 = await createSignatureHeader(SECRET, rawBody1);

      await processPaddleWebhookRequest("POST", rawBody1, header1, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });
      expect(db.userCredits.get(USER_ID)).toBe(500);

      // Same transaction under new event ID (e.g. Paddle redelivery)
      const rawBody2 = buildTransactionPayload({
        eventId: "evt_redelivery",
        transactionId: "txn_shared_123",
      });
      const header2 = await createSignatureHeader(SECRET, rawBody2);

      const res2 = await processPaddleWebhookRequest("POST", rawBody2, header2, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });
      expect(res2.status).toBe(200);
      expect(res2.body.duplicate).toBe(true);
      expect(res2.body.credits_added).toBe(0);
      expect(db.userCredits.get(USER_ID)).toBe(500);
    });
  });

  describe("Requirement 3: Concurrent duplicate fulfillment cannot double-credit", () => {
    it("allows only one execution to credit under simulated concurrent race", async () => {
      // NOTE: This test validates mock-level atomic contract handling.
      // Live multi-client PostgreSQL concurrency is guaranteed by the UNIQUE constraint in the SQL migration.
      const db = new MockPostgresDatabase();

      const rawBody1 = buildTransactionPayload({
        eventId: "evt_race_1",
        transactionId: "txn_race_shared",
      });
      const rawBody2 = buildTransactionPayload({
        eventId: "evt_race_2",
        transactionId: "txn_race_shared",
      });

      const header1 = await createSignatureHeader(SECRET, rawBody1);
      const header2 = await createSignatureHeader(SECRET, rawBody2);

      // Execute concurrently
      const [res1, res2] = await Promise.all([
        processPaddleWebhookRequest("POST", rawBody1, header1, {
          paddleWebhookSecret: SECRET,
          paddlePriceId: PRICE_ID,
          fulfillRpc: (params) => db.fulfillPaddleCredits(params),
        }),
        processPaddleWebhookRequest("POST", rawBody2, header2, {
          paddleWebhookSecret: SECRET,
          paddlePriceId: PRICE_ID,
          fulfillRpc: (params) => db.fulfillPaddleCredits(params),
        }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const totalCreditsAdded = res1.body.credits_added + res2.body.credits_added;
      expect(totalCreditsAdded).toBe(500);

      const duplicates = [res1.body.duplicate, res2.body.duplicate];
      expect(duplicates).toContain(true);
      expect(duplicates).toContain(false);

      expect(db.userCredits.get(USER_ID)).toBe(500);
    });
  });

  describe("Requirement 4: Two distinct purchases both work", () => {
    it("credits 500 for purchase 1 and 500 for purchase 2, resulting in balance 1000", async () => {
      const db = new MockPostgresDatabase();

      // Purchase 1
      const body1 = buildTransactionPayload({
        eventId: "evt_order_1",
        transactionId: "txn_order_1",
      });
      const header1 = await createSignatureHeader(SECRET, body1);
      const res1 = await processPaddleWebhookRequest("POST", body1, header1, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });
      expect(res1.status).toBe(200);
      expect(res1.body.credits_added).toBe(500);
      expect(res1.body.balance).toBe(500);

      // Purchase 2 (distinct transaction)
      const body2 = buildTransactionPayload({
        eventId: "evt_order_2",
        transactionId: "txn_order_2",
      });
      const header2 = await createSignatureHeader(SECRET, body2);
      const res2 = await processPaddleWebhookRequest("POST", body2, header2, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });
      expect(res2.status).toBe(200);
      expect(res2.body.credits_added).toBe(500);
      expect(res2.body.balance).toBe(1000);

      expect(db.userCredits.get(USER_ID)).toBe(1000);
      expect(db.processedTransactions.size).toBe(2);
    });
  });

  describe("Requirement 5: Transaction failure rolls back and permits retry", () => {
    it("returns 500 on database failure, leaves state unchanged, and fulfills on retry", async () => {
      const db = new MockPostgresDatabase();
      db.simulateFailure = true;

      const rawBody = buildTransactionPayload({
        eventId: "evt_retry_1",
        transactionId: "txn_retry_1",
      });
      const header = await createSignatureHeader(SECRET, rawBody);

      // Attempt 1: Database failure
      const failRes = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(failRes.status).toBe(500);
      expect(failRes.body.error).toContain("Credit fulfillment database failure");
      expect(db.userCredits.get(USER_ID)).toBe(0);
      expect(db.processedTransactions.has("txn_retry_1")).toBe(false);

      // Attempt 2: Database recovered, webhook retried by Paddle
      db.simulateFailure = false;
      const successRes = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(successRes.status).toBe(200);
      expect(successRes.body.duplicate).toBe(false);
      expect(successRes.body.credits_added).toBe(500);
      expect(db.userCredits.get(USER_ID)).toBe(500);
      expect(db.processedTransactions.has("txn_retry_1")).toBe(true);
    });
  });

  describe("Requirement 6: Invalid/expired signature is rejected", () => {
    it("rejects missing signature header with 401", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload();

      const res = await processPaddleWebhookRequest("POST", rawBody, null, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing Paddle-Signature header");
    });

    it("rejects tampered signature with 401", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload();
      const header = await createSignatureHeader(SECRET, rawBody);
      const tamperedHeader = header.replace(/h1=[a-f0-9]{5}/, "h1=00000");

      const res = await processPaddleWebhookRequest("POST", rawBody, tamperedHeader, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Signature mismatch");
    });

    it("rejects expired timestamp (>300 seconds old) with 401", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload();
      const now = 1700001000;
      const expiredTs = now - 305; // 305s ago
      const header = await createSignatureHeader(SECRET, rawBody, expiredTs);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
        verifyOptions: { currentTimestamp: now, toleranceSeconds: 300 },
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("expired");
    });

    it("rejects timestamp too far in the future (>60 seconds) with 401", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload();
      const now = 1700001000;
      const futureTs = now + 65; // 65s in future
      const header = await createSignatureHeader(SECRET, rawBody, futureTs);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
        verifyOptions: { currentTimestamp: now },
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("future");
    });
  });

  describe("Requirement 7: Wrong price, quantity, status or incomplete transaction is rejected", () => {
    it("rejects mismatched price ID with 400", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({ priceId: "pri_wrong_product_999" });
      const header = await createSignatureHeader(SECRET, rawBody);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid price_id");
      expect(db.userCredits.get(USER_ID)).toBe(0);
    });

    it("rejects invalid quantity (!= 1) with 400", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({ quantity: 2 });
      const header = await createSignatureHeader(SECRET, rawBody);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid item quantity: expected 1");
      expect(db.userCredits.get(USER_ID)).toBe(0);
    });

    it("rejects incomplete transaction status (e.g. draft, past_due) with 400", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({ status: "draft" });
      const header = await createSignatureHeader(SECRET, rawBody);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("expected 'completed'");
    });

    it("rejects missing or non-UUID user ID with 400", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({ userId: "invalid-user-identifier" });
      const header = await createSignatureHeader(SECRET, rawBody);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid or missing user_id");
    });

    it("safely ignores non-transaction events with 200 without fulfilling credits", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload({ eventType: "customer.created" });
      const header = await createSignatureHeader(SECRET, rawBody);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.ignored).toBe(true);
      expect(db.userCredits.get(USER_ID)).toBe(0);
    });

    it("rejects non-POST method with 405", async () => {
      const db = new MockPostgresDatabase();
      const res = await processPaddleWebhookRequest("GET", "", null, {
        paddleWebhookSecret: SECRET,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(405);
      expect(res.body.error).toBe("Method not allowed");
    });

    it("rejects missing server configuration with 500", async () => {
      const db = new MockPostgresDatabase();
      const rawBody = buildTransactionPayload();
      const header = await createSignatureHeader(SECRET, rawBody);

      const res = await processPaddleWebhookRequest("POST", rawBody, header, {
        paddleWebhookSecret: undefined,
        paddlePriceId: PRICE_ID,
        fulfillRpc: (params) => db.fulfillPaddleCredits(params),
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("PADDLE_WEBHOOK_SECRET not configured");
    });
  });

  describe("AirMileX Phase 5A: Paddle Checkout Environment Selection & Security", () => {
    const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
    const SANDBOX_KEY = "pdl_sdbx_apikey_99887766554433221100aabbccddeeff";
    const LIVE_KEY = "pdl_live_apikey_11223344556677889900aabbccddeeff";
    const PRICE_ID = "pri_01h8444a7qzp7k7pkv1k8cgn";

    describe("Environment Host Resolution & Validation", () => {
      it("resolves sandbox environment to sandbox API host", () => {
        const res = resolvePaddleApiHost("sandbox");
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.host).toBe(PADDLE_API_HOSTS.sandbox);
          expect(res.host).toBe("https://sandbox-api.paddle.com");
          expect(res.environment).toBe("sandbox");
        }
      });

      it("resolves live and production environments to live API host", () => {
        const liveRes = resolvePaddleApiHost("live");
        expect(liveRes.ok).toBe(true);
        if (liveRes.ok) {
          expect(liveRes.host).toBe(PADDLE_API_HOSTS.live);
          expect(liveRes.host).toBe("https://api.paddle.com");
          expect(liveRes.environment).toBe("live");
        }

        const prodRes = resolvePaddleApiHost("production");
        expect(prodRes.ok).toBe(true);
        if (prodRes.ok) {
          expect(prodRes.host).toBe("https://api.paddle.com");
          expect(prodRes.environment).toBe("live");
        }
      });

      it("handles case insensitivity and whitespace trimming", () => {
        const res1 = resolvePaddleApiHost("  SANDBOX  ");
        expect(res1.ok).toBe(true);
        if (res1.ok) {
          expect(res1.host).toBe("https://sandbox-api.paddle.com");
        }

        const res2 = resolvePaddleApiHost(" Live ");
        expect(res2.ok).toBe(true);
        if (res2.ok) {
          expect(res2.host).toBe("https://api.paddle.com");
        }
      });

      it("fails closed on missing or empty environment", () => {
        const nullRes = resolvePaddleApiHost(null);
        expect(nullRes.ok).toBe(false);
        if (!nullRes.ok) {
          expect(nullRes.error).toContain("PADDLE_ENVIRONMENT configuration missing");
        }

        const undefRes = resolvePaddleApiHost(undefined);
        expect(undefRes.ok).toBe(false);
        if (!undefRes.ok) {
          expect(undefRes.error).toContain("PADDLE_ENVIRONMENT configuration missing");
        }

        const emptyRes = resolvePaddleApiHost("");
        expect(emptyRes.ok).toBe(false);
      });

      it("fails closed on invalid, unknown, or arbitrary environment values", () => {
        const invalidEnvs = ["staging", "local", "dev", "test", "http://malicious-site.com", "true"];
        for (const env of invalidEnvs) {
          const res = resolvePaddleApiHost(env);
          expect(res.ok).toBe(false);
          if (!res.ok) {
            expect(res.error).toContain("Invalid PADDLE_ENVIRONMENT");
          }
        }
      });
    });

    describe("Credential Pairing, Official Format & Credential Isolation", () => {
      it("validates official modern sandbox key prefix (pdl_sdbx_apikey_)", () => {
        expect(validatePaddleCredentials("sandbox", SANDBOX_KEY).valid).toBe(true);
      });

      it("validates official modern live key prefix (pdl_live_apikey_)", () => {
        expect(validatePaddleCredentials("live", LIVE_KEY).valid).toBe(true);
      });

      it("rejects live API key when environment is sandbox", () => {
        const res = validatePaddleCredentials("sandbox", LIVE_KEY);
        expect(res.valid).toBe(false);
        expect(res.error).toContain("Live Paddle API key cannot be used in sandbox");
      });

      it("rejects sandbox API key when environment is live", () => {
        const res = validatePaddleCredentials("live", SANDBOX_KEY);
        expect(res.valid).toBe(false);
        expect(res.error).toContain("Sandbox Paddle API key cannot be used in live");
      });

      it("rejects outdated or incorrect pdl_sdb_ prefix in sandbox", () => {
        const res = validatePaddleCredentials("sandbox", "pdl_sdb_apikey_99887766554433221100");
        expect(res.valid).toBe(false);
        expect(res.error).toContain("Invalid Paddle sandbox API key format: must begin with 'pdl_sdbx_apikey_'");
      });

      it("rejects unexpected or generic formats without documented prefix", () => {
        const res1 = validatePaddleCredentials("sandbox", "pdl_apikey_generic_1234567890");
        expect(res1.valid).toBe(false);
        expect(res1.error).toContain("must begin with 'pdl_sdbx_apikey_'");

        const res2 = validatePaddleCredentials("live", "pdl_apikey_generic_1234567890");
        expect(res2.valid).toBe(false);
        expect(res2.error).toContain("must begin with 'pdl_live_apikey_'");
      });

      it("rejects keys that are too short or contain invalid characters", () => {
        const resShort = validatePaddleCredentials("sandbox", "pdl_sdbx_apikey_short");
        expect(resShort.valid).toBe(false);
        expect(resShort.error).toContain("Malformed Paddle sandbox API key");
      });
    });

    describe("Requirement 0: Server-Side Payment Launch Gate", () => {
      it("rejects checkout when checkoutEnabled is undefined / omitted with 403 Forbidden", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Paid checkout is currently disabled");
      });

      it("rejects checkout when checkoutEnabled is false with 403 Forbidden", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: false,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Paid checkout is currently disabled");
      });

      it("rejects checkout when checkoutEnabled is string 'false' or invalid string", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: "false",
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Paid checkout is currently disabled");
      });

      it("allows checkout when checkoutEnabled is boolean true or string 'true'", async () => {
        const mockFetch: typeof fetch = async () => {
          return new Response(
            JSON.stringify({
              data: { id: "txn_gate_001", checkout: { url: "https://sandbox-checkout.paddle.com" } },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: "true",
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(res.status).toBe(200);
        expect(res.body.transaction_id).toBe("txn_gate_001");
      });
    });

    describe("Requirement 1 & 2: API Host Selection for Sandbox and Live", () => {
      it("Sandbox configuration selects the Sandbox API host (https://sandbox-api.paddle.com)", async () => {
        let capturedUrl = "";
        let capturedHeaders: Record<string, string> = {};
        let capturedBody = "";

        const mockFetch: typeof fetch = async (url, init) => {
          capturedUrl = String(url);
          capturedHeaders = (init?.headers as Record<string, string>) ?? {};
          capturedBody = String(init?.body ?? "");

          return new Response(
            JSON.stringify({
              data: {
                id: "txn_sdb_001",
                checkout: { url: "https://sandbox-checkout.paddle.com/checkout/txn_sdb_001" },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(res.status).toBe(200);
        expect(capturedUrl).toBe("https://sandbox-api.paddle.com/transactions");
        expect(capturedHeaders["Authorization"]).toBe(`Bearer ${SANDBOX_KEY}`);
        expect(res.body.transaction_id).toBe("txn_sdb_001");
        expect(res.body.checkout_url).toBe("https://sandbox-checkout.paddle.com/checkout/txn_sdb_001");

        const parsedBody = JSON.parse(capturedBody);
        expect(parsedBody.items).toEqual([{ price_id: PRICE_ID, quantity: 1 }]);
        expect(parsedBody.custom_data).toEqual({ user_id: VALID_USER_ID });
      });

      it("Live configuration selects the Live API host (https://api.paddle.com)", async () => {
        let capturedUrl = "";
        const mockFetch: typeof fetch = async (url) => {
          capturedUrl = String(url);
          return new Response(
            JSON.stringify({
              data: {
                id: "txn_live_001",
                checkout: { url: "https://checkout.paddle.com/checkout/txn_live_001" },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "live",
          apiKey: LIVE_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(res.status).toBe(200);
        expect(capturedUrl).toBe("https://api.paddle.com/transactions");
        expect(res.body.transaction_id).toBe("txn_live_001");
        expect(res.body.checkout_url).toBe("https://checkout.paddle.com/checkout/txn_live_001");
      });
    });

    describe("Requirement 3: Invalid or missing environment configuration fails closed", () => {
      it("fails closed on missing environment without initiating HTTP transaction", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: undefined,
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(500);
        expect(res.body.error).toContain("PADDLE_ENVIRONMENT configuration missing");
      });

      it("fails closed on invalid environment without initiating HTTP transaction", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "staging",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(500);
        expect(res.body.error).toContain("Invalid PADDLE_ENVIRONMENT");
      });
    });

    describe("Requirement 4: No API key appears in responses", () => {
      it("does not leak API key in 200 success response", async () => {
        const mockFetch: typeof fetch = async () => {
          return new Response(
            JSON.stringify({
              data: {
                id: "txn_001",
                checkout: { url: "https://sandbox-checkout.paddle.com/checkout/txn_001" },
              },
            }),
            { status: 200 }
          );
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain(SANDBOX_KEY);
        expect(bodyStr).not.toContain("pdl_");
      });

      it("does not leak API key in 502 upstream error response", async () => {
        const mockFetch: typeof fetch = async () => {
          // Paddle upstream error response potentially returning details
          return new Response(
            JSON.stringify({
              error: {
                type: "authentication_error",
                message: `Invalid key ${SANDBOX_KEY}`,
              },
            }),
            { status: 401 }
          );
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(res.status).toBe(502);
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain(SANDBOX_KEY);
        expect(bodyStr).not.toContain("authentication_error");
        expect(res.body.error).toBe("Failed to create checkout");
      });

      it("does not leak API key in 500 configuration or network error responses", async () => {
        // Network throw
        const mockFetch: typeof fetch = async () => {
          throw new Error(`Failed to connect with secret ${SANDBOX_KEY}`);
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(res.status).toBe(500);
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain(SANDBOX_KEY);
        expect(res.body.error).toBe("Internal server error");
      });

      it("regression test: never leaks raw exception messages or API keys into console.error or response", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const secretToProtect = "pdl_sdbx_apikey_SECRET_CANARY_VALUE_1234567890abcdef";

        const mockFetch: typeof fetch = async () => {
          throw new Error(`Fatal connection failure using Bearer ${secretToProtect}`);
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: secretToProtect,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Internal server error");

        // Verify response contains no secret
        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain(secretToProtect);
        expect(bodyStr).not.toContain("SECRET_CANARY");
        expect(bodyStr).not.toContain("Bearer");

        // Verify console.error contains no secret
        const loggedCalls = errorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(loggedCalls).not.toContain(secretToProtect);
        expect(loggedCalls).not.toContain("SECRET_CANARY");
        expect(loggedCalls).not.toContain("Bearer");

        errorSpy.mockRestore();
      });
    });

    describe("Requirement 5: Missing Paddle credentials do not initiate a transaction", () => {
      it("rejects missing apiKey without invoking fetch", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: undefined,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Payment configuration missing");
      });

      it("rejects missing priceId without invoking fetch", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: undefined,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Payment configuration missing");
      });

      it("rejects mixed credentials (live key in sandbox) without invoking fetch", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: LIVE_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(500);
        expect(res.body.error).toContain("Live Paddle API key cannot be used in sandbox");
      });

      it("rejects mixed credentials (sandbox key in live) without invoking fetch", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "live",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: VALID_USER_ID,
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(500);
        expect(res.body.error).toContain("Sandbox Paddle API key cannot be used in live");
      });

      it("rejects non-UUID userId without invoking fetch", async () => {
        let fetchCalled = false;
        const mockFetch: typeof fetch = async () => {
          fetchCalled = true;
          return new Response("{}", { status: 200 });
        };

        const res = await createPaddleCheckoutTransaction({
          checkoutEnabled: true,
          environment: "sandbox",
          apiKey: SANDBOX_KEY,
          priceId: PRICE_ID,
          userId: "malicious-user-id-not-uuid",
          fetchFn: mockFetch,
        });

        expect(fetchCalled).toBe(false);
        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Unauthorized");
      });
    });
  });
});

