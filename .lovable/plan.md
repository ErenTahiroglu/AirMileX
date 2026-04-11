

# Paddle Integration — Execution Plan

## Overview
Rename the Polar events table, create two edge functions (checkout + webhook), add frontend Paddle service, and wire "Buy 500 Credits" buttons on Dashboard and Pricing pages. The checkout edge function fetches `PADDLE_PRICE_ID` from environment — never from the client.

## 1. Database Migration

```sql
ALTER TABLE public.processed_polar_events RENAME TO processed_paddle_events;
```

Existing RLS policy (service_role only) carries over.

## 2. Secrets Required (3)

Before edge functions work, three secrets must be provided:
- **PADDLE_API_KEY** — Paddle Billing API key
- **PADDLE_WEBHOOK_SECRET** — Paddle webhook signing secret
- **PADDLE_PRICE_ID** — The Paddle Price ID for the 500-credit product (fetched server-side only, never from client)

## 3. `supabase/config.toml`

Add webhook function config to disable JWT verification:
```toml
[functions.paddle-webhook]
verify_jwt = false
```

## 4. `supabase/functions/paddle-checkout/index.ts` (Create)

- CORS + OPTIONS handler
- Extract `user_id` from JWT via `getClaims()`
- Read `PADDLE_PRICE_ID` from `Deno.env.get('PADDLE_PRICE_ID')` — **not** from request body
- POST to `https://api.paddle.com/transactions` with `PADDLE_API_KEY`
- Pass `user_id` in `custom_data`, use server-side price ID in `items`
- Return transaction details / checkout URL

## 5. `supabase/functions/paddle-webhook/index.ts` (Create)

- Verify `Paddle-Signature` header using `PADDLE_WEBHOOK_SECRET` (HMAC-SHA256 over `ts:rawBody`)
- Filter for `transaction.completed` event only
- **Idempotency**: INSERT event ID into `processed_paddle_events`; on unique conflict → return 200
- Extract `user_id` from `data.custom_data.user_id`
- Service-role client: `UPDATE user_settings SET credits = credits + 500 WHERE id = user_id`
- Return 200 OK

## 6. `src/services/paddle.ts` (Create)

```typescript
import { supabase } from "@/integrations/supabase/client";

export const createCheckout = async () => {
  const { data, error } = await supabase.functions.invoke("paddle-checkout");
  if (error) throw error;
  return data;
};
```

No price ID or product ID sent from client — the function takes no body parameters.

## 7. `src/pages/Dashboard.tsx` (Update)

- Add "Buy 500 Credits" button next to the Credits card
- On click: loading state → `createCheckout()` → open checkout URL
- Error handling via toast

## 8. `src/pages/PricingPage.tsx` (Update)

- Wire the "Buy Credits" button to call `createCheckout()` (requires auth; redirect to `/` if not logged in)
- Replace the disabled placeholder button

## Files Summary

| File | Action |
|------|--------|
| Migration SQL | Rename `processed_polar_events` → `processed_paddle_events` |
| `supabase/config.toml` | Add `[functions.paddle-webhook]` block |
| `supabase/functions/paddle-checkout/index.ts` | Create |
| `supabase/functions/paddle-webhook/index.ts` | Create |
| `src/services/paddle.ts` | Create |
| `src/pages/Dashboard.tsx` | Add buy button |
| `src/pages/PricingPage.tsx` | Wire buy button |

## Security Notes
- `PADDLE_PRICE_ID` is **never** accepted from the client — fetched exclusively via `Deno.env.get()` in the checkout edge function
- Webhook signature verified before any processing
- Credits added via service-role client (bypasses the `prevent_credits_tampering` trigger correctly)
- Idempotency check prevents double-crediting from replayed webhooks

