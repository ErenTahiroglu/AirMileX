

# Stripe Credit System — Execution Plan

## Current State
- `user_settings` table exists but has no `credits` column
- `airtable-proxy` edge function exists with sync-records but no credit checks
- No Stripe integration enabled yet
- No `processed_stripe_events` table
- No `deduct_credits` RPC function

## Step 1: Database Migrations

**Migration A — Add `credits` column to `user_settings`:**
```sql
ALTER TABLE user_settings ADD COLUMN credits integer NOT NULL DEFAULT 50;
```

**Migration B — Create `processed_stripe_events` table:**
```sql
CREATE TABLE processed_stripe_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policies — only service role accesses this table
```

**Migration C — Create `deduct_credits` RPC function:**
```sql
CREATE OR REPLACE FUNCTION deduct_credits(p_user_id uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

## Step 2: Enable Stripe

Use `stripe--enable_stripe` tool to collect the Stripe secret key and unlock Stripe tools/context.

## Step 3: Update `airtable-proxy` Edge Function

In the `sync-records` case, add credit enforcement using JWT-based auth (IDOR fix):

1. Extract JWT from `Authorization` header using `getClaims()` to get `user_id` — never from request body
2. Create a service-role Supabase client
3. Check `user_settings.credits >= records.length` — return 402 if insufficient
4. Execute existing batching algorithm (unchanged)
5. Call `deduct_credits` RPC with `synced` count atomically
6. Return `{ synced, failed, errors, credits_remaining }` in response

## Step 4: Create `stripe-checkout` Edge Function

- Validates JWT via `getClaims()` to get `user_id`
- Creates Stripe Checkout Session: 500 credits line item, metadata `{ user_id }`
- Returns `{ url }` for client redirect

## Step 5: Create `stripe-webhook` Edge Function

- Verifies Stripe signature
- On `checkout.session.completed`: attempt INSERT into `processed_stripe_events` with event ID
- If duplicate (constraint violation) → return 200, skip
- If new → `UPDATE user_settings SET credits = credits + 500 WHERE id = metadata.user_id`
- Return 200

## Step 6: Frontend Changes

**`src/services/settings.ts`**: Add `credits` to `UserSettings` interface and SELECT query.

**`src/services/stripe.ts`** (new): `createCheckoutSession()` calls `stripe-checkout` edge function.

**`src/pages/Dashboard.tsx`**: Display credits in a bold card, add "Buy More Credits" button.

**`src/pages/NewJobPage.tsx`**: Handle 402 from sync — show "Not enough credits" toast.

## Files Modified/Created
- 3 database migrations
- `supabase/functions/airtable-proxy/index.ts` — updated
- `supabase/functions/stripe-checkout/index.ts` — new
- `supabase/functions/stripe-webhook/index.ts` — new
- `src/services/settings.ts` — updated
- `src/services/stripe.ts` — new
- `src/pages/Dashboard.tsx` — updated
- `src/pages/NewJobPage.tsx` — updated

