// Shared paddle webhook validation and signature verification module
// Adheres strictly to Paddle Billing webhook standards

export interface VerifySignatureOptions {
  toleranceSeconds?: number;
  currentTimestamp?: number; // epoch seconds, useful for testing
}

/**
 * Constant-time string equality comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  let mismatch = lenA ^ lenB;
  const maxLen = Math.max(lenA, lenB);
  for (let i = 0; i < maxLen; i++) {
    const charA = i < lenA ? a.charCodeAt(i) : 0;
    const charB = i < lenB ? b.charCodeAt(i) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}

/**
 * Computes HMAC-SHA256 of payload with secret, returned as lowercase hex string.
 * Uses standard Web Crypto API supported by Deno, Node, Bun, and browsers.
 */
export async function computeHmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifies the Paddle-Signature header against the unmodified raw request body.
 * Paddle-Signature header format: ts=1671552777;h1=eb4ae...
 * Signed payload: ${ts}:${rawBody}
 * Rejects timestamps older than toleranceSeconds (default 300s / 5 min) or future drift (>60s).
 */
export async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifySignatureOptions = {}
): Promise<{ valid: boolean; reason?: string }> {
  if (!secret) {
    return { valid: false, reason: "Missing webhook secret" };
  }
  if (!signatureHeader || !signatureHeader.trim()) {
    return { valid: false, reason: "Missing Paddle-Signature header" };
  }

  const parts = new Map<string, string>();
  for (const part of signatureHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx !== -1) {
      const key = part.slice(0, eqIdx).trim();
      const val = part.slice(eqIdx + 1).trim();
      if (key && val) {
        parts.set(key, val);
      }
    }
  }

  const tsStr = parts.get("ts");
  const h1 = parts.get("h1");
  if (!tsStr || !h1) {
    return { valid: false, reason: "Malformed Paddle-Signature header: missing ts or h1" };
  }

  const ts = parseInt(tsStr, 10);
  if (Number.isNaN(ts) || ts <= 0) {
    return { valid: false, reason: "Invalid timestamp in Paddle-Signature header" };
  }

  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.currentTimestamp ?? Math.floor(Date.now() / 1000);

  if (now - ts > tolerance) {
    return { valid: false, reason: `Signature timestamp expired (${now - ts}s > ${tolerance}s)` };
  }
  if (ts - now > 60) {
    return { valid: false, reason: "Signature timestamp too far in future" };
  }

  const payload = `${tsStr}:${rawBody}`;
  const computedHex = await computeHmacSha256Hex(secret, payload);

  if (!timingSafeEqual(computedHex.toLowerCase(), h1.toLowerCase())) {
    return { valid: false, reason: "Signature mismatch" };
  }

  return { valid: true };
}

export type PaddleValidationResult =
  | {
      action: "fulfill";
      eventId: string;
      transactionId: string;
      userId: string;
      credits: number;
      priceId: string;
    }
  | {
      action: "ignore";
      eventType: string;
      reason: string;
    }
  | {
      action: "error";
      status: number;
      reason: string;
    };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates the parsed Paddle event structure, event type, status, price, quantity, and user ID.
 */
export function validatePaddleWebhookPayload(
  rawBody: string,
  expectedPriceId: string
): PaddleValidationResult {
  if (!expectedPriceId || !expectedPriceId.trim()) {
    return {
      action: "error",
      status: 500,
      reason: "PADDLE_PRICE_ID configuration missing",
    };
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return {
      action: "error",
      status: 400,
      reason: "Malformed JSON payload",
    };
  }

  if (!event || typeof event !== "object") {
    return {
      action: "error",
      status: 400,
      reason: "Invalid webhook payload structure",
    };
  }

  // If not transaction.completed, ignore safely (Paddle sends other events like transaction.created, etc.)
  if (event.event_type !== "transaction.completed") {
    return {
      action: "ignore",
      eventType: String(event.event_type ?? "unknown"),
      reason: `Unhandled event type: ${event.event_type}`,
    };
  }

  const eventId = event.event_id;
  if (!eventId || typeof eventId !== "string" || !eventId.trim()) {
    return {
      action: "error",
      status: 400,
      reason: "Missing event_id in payload",
    };
  }

  const data = event.data;
  if (!data || typeof data !== "object") {
    return {
      action: "error",
      status: 400,
      reason: "Missing data object in transaction payload",
    };
  }

  // Transaction ID
  const transactionId = data.id;
  if (!transactionId || typeof transactionId !== "string" || !transactionId.trim()) {
    return {
      action: "error",
      status: 400,
      reason: "Missing transaction id in payload data",
    };
  }

  // Must be completed status
  if (data.status !== "completed") {
    return {
      action: "error",
      status: 400,
      reason: `Transaction status is '${data.status}', expected 'completed'`,
    };
  }

  // Validate items
  const items = data.items;
  if (!Array.isArray(items) || items.length === 0) {
    return {
      action: "error",
      status: 400,
      reason: "Transaction items must contain line items",
    };
  }

  if (items.length !== 1) {
    return {
      action: "error",
      status: 400,
      reason: `Expected exactly 1 line item for credit purchase, received ${items.length}`,
    };
  }

  const item = items[0];
  if (!item || typeof item !== "object") {
    return {
      action: "error",
      status: 400,
      reason: "Invalid line item in transaction",
    };
  }

  if (item.quantity !== 1) {
    return {
      action: "error",
      status: 400,
      reason: `Invalid item quantity: expected 1, received ${item.quantity}`,
    };
  }

  const priceId = item.price?.id ?? item.price_id;
  if (!priceId || priceId !== expectedPriceId) {
    return {
      action: "error",
      status: 400,
      reason: `Invalid price_id: received '${priceId}', expected '${expectedPriceId}'`,
    };
  }

  // User ID derivation from custom_data
  const userId = data.custom_data?.user_id;
  if (!userId || typeof userId !== "string" || !UUID_REGEX.test(userId)) {
    return {
      action: "error",
      status: 400,
      reason: `Invalid or missing user_id in transaction custom_data: '${userId}'`,
    };
  }

  return {
    action: "fulfill",
    eventId: eventId.trim(),
    transactionId: transactionId.trim(),
    userId: userId.trim(),
    credits: 500,
    priceId,
  };
}

export interface PaddleFulfillmentRpcResponse {
  success: boolean;
  duplicate: boolean;
  credits_added: number;
  balance: number;
}

export interface ProcessWebhookDeps {
  paddleWebhookSecret: string | undefined;
  paddlePriceId: string | undefined;
  fulfillRpc: (params: {
    eventId: string;
    transactionId: string;
    userId: string;
    credits: number;
  }) => Promise<{ data: PaddleFulfillmentRpcResponse | null; error: any }>;
  verifyOptions?: VerifySignatureOptions;
}

export interface ProcessWebhookResponse {
  status: number;
  body: Record<string, any>;
}

/**
 * High-level orchestration for processing Paddle webhook requests.
 */
export async function processPaddleWebhookRequest(
  method: string,
  rawBody: string,
  signatureHeader: string | null | undefined,
  deps: ProcessWebhookDeps
): Promise<ProcessWebhookResponse> {
  if (method !== "POST") {
    return {
      status: 405,
      body: { error: "Method not allowed" },
    };
  }

  if (!deps.paddleWebhookSecret) {
    return {
      status: 500,
      body: { error: "PADDLE_WEBHOOK_SECRET not configured" },
    };
  }

  if (!deps.paddlePriceId) {
    return {
      status: 500,
      body: { error: "PADDLE_PRICE_ID not configured" },
    };
  }

  const sigCheck = await verifyPaddleSignature(
    rawBody,
    signatureHeader,
    deps.paddleWebhookSecret,
    deps.verifyOptions
  );

  if (!sigCheck.valid) {
    return {
      status: 401,
      body: { error: sigCheck.reason ?? "Invalid signature" },
    };
  }

  const validation = validatePaddleWebhookPayload(rawBody, deps.paddlePriceId);

  if (validation.action === "ignore") {
    return {
      status: 200,
      body: { ok: true, ignored: true, event_type: validation.eventType },
    };
  }

  if (validation.action === "error") {
    return {
      status: validation.status,
      body: { error: validation.reason },
    };
  }

  // Atomic fulfillment RPC execution
  try {
    const { data, error } = await deps.fulfillRpc({
      eventId: validation.eventId,
      transactionId: validation.transactionId,
      userId: validation.userId,
      credits: validation.credits,
    });

    if (error || !data) {
      console.error("fulfill_paddle_credits RPC failure:", error);
      return {
        status: 500,
        body: {
          error: "Credit fulfillment database failure",
          details: error?.message ?? "Unknown database error",
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        duplicate: data.duplicate,
        credits_added: data.credits_added,
        balance: data.balance,
      },
    };
  } catch (err: any) {
    console.error("Unexpected error in fulfillRpc call:", err);
    return {
      status: 500,
      body: {
        error: "Internal error during fulfillment",
        details: err?.message ?? String(err),
      },
    };
  }
}

export type PaddleEnvironment = "sandbox" | "live";

export const PADDLE_API_HOSTS: Record<PaddleEnvironment, string> = {
  sandbox: "https://sandbox-api.paddle.com",
  live: "https://api.paddle.com",
};

export type ResolvePaddleHostResult =
  | { ok: true; host: string; environment: PaddleEnvironment }
  | { ok: false; error: string };

/**
 * Resolves the Paddle API base URL from the configured environment.
 * Rejects missing, unknown, or ambiguous environment strings (fails closed).
 */
export function resolvePaddleApiHost(
  environment: string | null | undefined
): ResolvePaddleHostResult {
  if (!environment || typeof environment !== "string") {
    return { ok: false, error: "PADDLE_ENVIRONMENT configuration missing" };
  }

  const normalized = environment.trim().toLowerCase();
  if (normalized === "sandbox") {
    return { ok: true, host: PADDLE_API_HOSTS.sandbox, environment: "sandbox" };
  }
  if (normalized === "live" || normalized === "production") {
    return { ok: true, host: PADDLE_API_HOSTS.live, environment: "live" };
  }

  return {
    ok: false,
    error: `Invalid PADDLE_ENVIRONMENT: '${environment}'. Must be 'sandbox' or 'live'`,
  };
}

/**
 * Validates that Paddle API credentials match the configured environment and official key format.
 * Official Paddle Billing modern keys:
 * - Sandbox: pdl_sdbx_apikey_...
 * - Live: pdl_live_apikey_...
 */
const PADDLE_SANDBOX_KEY_PREFIX = "pdl_sdbx_apikey_";
const PADDLE_LIVE_KEY_PREFIX = "pdl_live_apikey_";
const PADDLE_KEY_REGEX = {
  sandbox: /^pdl_sdbx_apikey_[a-zA-Z0-9_-]{10,}$/,
  live: /^pdl_live_apikey_[a-zA-Z0-9_-]{10,}$/,
};

export function validatePaddleCredentials(
  environment: PaddleEnvironment,
  apiKey: string | null | undefined
): { valid: boolean; error?: string } {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { valid: false, error: "Payment configuration missing" };
  }
  const trimmed = apiKey.trim();

  if (environment === "sandbox") {
    if (trimmed.startsWith("pdl_live_")) {
      return { valid: false, error: "Live Paddle API key cannot be used in sandbox environment" };
    }
    if (!trimmed.startsWith(PADDLE_SANDBOX_KEY_PREFIX)) {
      return {
        valid: false,
        error: `Invalid Paddle sandbox API key format: must begin with '${PADDLE_SANDBOX_KEY_PREFIX}'`,
      };
    }
    if (!PADDLE_KEY_REGEX.sandbox.test(trimmed)) {
      return {
        valid: false,
        error: "Malformed Paddle sandbox API key: invalid characters or length",
      };
    }
    return { valid: true };
  }

  if (environment === "live") {
    if (trimmed.startsWith("pdl_sdbx_") || trimmed.startsWith("pdl_sdb_")) {
      return { valid: false, error: "Sandbox Paddle API key cannot be used in live environment" };
    }
    if (!trimmed.startsWith(PADDLE_LIVE_KEY_PREFIX)) {
      return {
        valid: false,
        error: `Invalid Paddle live API key format: must begin with '${PADDLE_LIVE_KEY_PREFIX}'`,
      };
    }
    if (!PADDLE_KEY_REGEX.live.test(trimmed)) {
      return {
        valid: false,
        error: "Malformed Paddle live API key: invalid characters or length",
      };
    }
    return { valid: true };
  }

  return { valid: false, error: "Invalid payment environment" };
}

export interface CreatePaddleCheckoutParams {
  environment: string | null | undefined;
  apiKey: string | null | undefined;
  priceId: string | null | undefined;
  userId: string | null | undefined;
  fetchFn?: typeof fetch;
}

export interface PaddleCheckoutResult {
  status: number;
  body: {
    transaction_id?: string;
    checkout_url?: string;
    error?: string;
  };
}

/**
 * Creates a Paddle Billing checkout transaction session.
 * Enforces explicit environment selection, fail-closed validation, and credential security.
 */
export async function createPaddleCheckoutTransaction(
  params: CreatePaddleCheckoutParams
): Promise<PaddleCheckoutResult> {
  // Validate user ID format
  if (!params.userId || typeof params.userId !== "string" || !UUID_REGEX.test(params.userId.trim())) {
    return {
      status: 401,
      body: { error: "Unauthorized" },
    };
  }

  // Validate environment (fail closed)
  const hostRes = resolvePaddleApiHost(params.environment);
  if (!hostRes.ok) {
    return {
      status: 500,
      body: { error: hostRes.error },
    };
  }

  // Validate price ID and API key presence
  if (
    !params.apiKey ||
    typeof params.apiKey !== "string" ||
    !params.apiKey.trim() ||
    !params.priceId ||
    typeof params.priceId !== "string" ||
    !params.priceId.trim()
  ) {
    return {
      status: 500,
      body: { error: "Payment configuration missing" },
    };
  }

  // Validate credentials environment pairing
  const credRes = validatePaddleCredentials(hostRes.environment, params.apiKey);
  if (!credRes.valid) {
    return {
      status: 500,
      body: { error: credRes.error ?? "Invalid payment credentials" },
    };
  }

  const endpoint = `${hostRes.host}/transactions`;
  const fetcher = params.fetchFn ?? fetch;

  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ price_id: params.priceId.trim(), quantity: 1 }],
        custom_data: { user_id: params.userId.trim() },
      }),
    });

    let result: any = null;
    try {
      result = await response.json();
    } catch {
      // response wasn't valid JSON
    }

    if (!response.ok) {
      console.error(
        `Paddle API transaction creation failed with HTTP ${response.status}`
      );
      return {
        status: 502,
        body: { error: "Failed to create checkout" },
      };
    }

    return {
      status: 200,
      body: {
        transaction_id: result?.data?.id,
        checkout_url: result?.data?.checkout?.url,
      },
    };
  } catch (err: unknown) {
    // Sanitize: never log raw error messages or objects that could contain credentials/headers
    const errorType = err instanceof Error ? err.name : "UnknownError";
    console.error(`Paddle checkout transaction request failed (${errorType})`);
    return {
      status: 500,
      body: { error: "Internal server error" },
    };
  }
}
