

# Polar.sh Credit System — Execution Plan

## Summary

6 steps: 3 database migrations, update airtable-proxy, create 2 new edge functions, update frontend. All payment logic uses Polar.sh REST API — zero Stripe code.

## Step 1: Database Migrations (single migration file)

```sql
-- A: Add credits column
ALTER TABLE user_settings ADD COLUMN credits integer NOT NULL DEFAULT 50;

-- B: Idempotency table for Polar webhooks
CREATE TABLE processed_polar_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE processed_polar_events ENABLE ROW LEVEL SECURITY;

-- C: Atomic credit deduction RPC
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id uuid, p_amount integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  UPDATE user_settings SET credits = credits - p_amount
  WHERE id = p_user_id AND credits >= p_amount
  RETURNING credits INTO new_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient credits'; END IF;
  RETURN new_balance;
END;
$$;
```

## Step 2: Collect Polar Secrets

Request two secrets via the `add_secret` tool:
- `POLAR_ACCESS_TOKEN` — Organization access token from Polar dashboard
- `POLAR_WEBHOOK_SECRET` — Webhook signing secret from Polar webhook settings

Also need the Polar Product ID for "500 Mileage Credits". Will request this from the user or use a Polar MCP tool if available.

## Step 3: Update `airtable-proxy` Edge Function

Only the `sync-records` case changes. Add before the existing batching logic:

1. Parse the JWT from the `Authorization` header to extract `user_id` (using Supabase's `createClient` with service role key + `auth.getUser()`)
2. Query `user_settings.credits` for that user
3. If `credits < records.length` → return 402 with `{ error: "Insufficient credits", credits_available }`
4. Run existing `syncWithBatching()` unchanged
5. After sync, call `deduct_credits` RPC atomically with `synced` count
6. Return `{ synced, failed, errors, credits_remaining }`

All other actions (whoami, list-bases, list-tables, read-records) remain untouched.

## Step 4: Create `polar-checkout` Edge Function

New file: `supabase/functions/polar-checkout/index.ts`

- Extract user JWT → get `user_id` via Supabase service role client
- Call `POST https://api.polar.sh/v1/checkouts/` with:
  - `products: [PRODUCT_ID]`
  - `success_url: <app dashboard URL>`
  - `customer_external_id: user_id`
  - `metadata: { user_id }`
- Return `{ url: checkout.url }` to client

## Step 5: Create `polar-webhook` Edge Function

New file: `supabase/functions/polar-webhook/index.ts`

- Verify Polar webhook signature using Standard Webhooks spec (HMAC SHA-256 with `webhook-id`, `webhook-timestamp`, `webhook-signature` headers)
- On `order.created` event:
  - Attempt `INSERT INTO processed_polar_events (id) VALUES (event_id)`
  - If constraint violation → return 200 (already processed)
  - If new → `UPDATE user_settings SET credits = credits + 500 WHERE id = metadata.user_id`
- Return 200

Config: `verify_jwt = false` in `supabase/config.toml` for this function (Polar calls it directly).

## Step 6: Frontend Changes

**`src/services/settings.ts`**
- Add `credits: number` to `UserSettings` interface
- Add `credits` to the SELECT query

**`src/services/polar.ts`** (new)
- `createCheckoutSession()` → calls `polar-checkout` edge function via `supabase.functions.invoke`
- Returns the checkout URL

**`src/pages/Dashboard.tsx`**
- Fetch `credits` from `getSettings()` alongside existing data
- Display credits in a bold card next to total records
- Add "Buy More Credits" button → calls `createCheckoutSession()` → `window.location.href = url`

**`src/pages/NewJobPage.tsx`**
- In `handleSync`, catch errors containing "402" or "Insufficient credits"
- Show toast: "Not enough credits — buy more from the dashboard"

## Files Modified/Created

| File | Action |
|------|--------|
| 1 migration SQL | Created |
| `supabase/functions/airtable-proxy/index.ts` | Updated (sync-records credit check) |
| `supabase/functions/polar-checkout/index.ts` | Created |
| `supabase/functions/polar-webhook/index.ts` | Created |
| `supabase/config.toml` | Updated (verify_jwt = false for polar-webhook) |
| `src/services/settings.ts` | Updated (add credits) |
| `src/services/polar.ts` | Created |
| `src/pages/Dashboard.tsx` | Updated (credits display + buy button) |
| `src/pages/NewJobPage.tsx` | Updated (402 error handling) |

## Security

| Threat | Mitigation |
|--------|-----------|
| Race condition on credits | Atomic `UPDATE ... WHERE credits >= amount` in single SQL |
| IDOR (spending other user's credits) | `user_id` extracted from JWT server-side, never from request body |
| Webhook replay / duplicate credits | `processed_polar_events` PK constraint — duplicate INSERT fails |
| Negative balance | SQL `WHERE credits >= p_amount` prevents over-deduction |
| Webhook forgery | Standard Webhooks HMAC-SHA256 signature verification |

## Prerequisites Before Execution

I need the user to provide:
1. **POLAR_ACCESS_TOKEN** — Polar organization access token
2. **POLAR_WEBHOOK_SECRET** — Polar webhook signing secret
3. **Polar Product ID** — The ID of the "500 Mileage Credits" product (must be created in Polar dashboard first, or via MCP tools if connected)

