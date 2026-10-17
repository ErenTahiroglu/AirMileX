# Project Memory

## Core
Mileage Calculator App — React/Vite/Tailwind/Supabase.
All external APIs (Airtable, operator-managed Geoapify) proxied through Supabase Edge Functions. Never call from client.
Airtable integration: 10-record batches, 250ms delay, exponential backoff on 429, offset pagination with field projection allowlist.
Tables: user_settings, calculation_logs, saved_mappings, saved_address_pairs, processed_paddle_events, account_deletion_attempts — all RLS-protected.
Design system tokens: --success / --success-foreground, Radix UI primitives, Sonner notifications.
Routing: Selective route lazy loading with scoped lazyWithRetry and RouteErrorBoundary recovery.
Credit system:
- 50 free credits granted upon registration (enforced by database trigger).
- Atomic reservation via reserve_credits RPC (returns 402 on insufficient credits).
- Unused credit refunds via refund_credits RPC on calculation abort/partial failure.
- One-time credit pack purchase ($9 for 500 credits) fulfilled idempotently via fulfill_paddle_credits RPC.
- Legacy deduct_credits RPC is deprecated, hard-coded to reject non-positive amounts, and restricted to service_role.
- All credit mutation RPCs restricted to service_role only (revoked from PUBLIC, anon, authenticated).
Account deletion:
- Server-side email OTP step-up verification required.
- Sanitized audit logging in account_deletion_attempts (PII, tokens, connection strings redacted).
- Client responses return generic errors with category codes.

## Memories
- [Architecture](mem://features/architecture) — Edge function proxy design, CORS, batching algorithm
- [DB Schema](mem://features/db-schema) — All tables, columns, constraints, RLS policies
