# Project Memory

## Core
Mileage Calculator App — React/Vite/Tailwind/Supabase.
All external APIs (Airtable, operator-managed Geoapify) proxied through Edge Functions. Never call from client.
Airtable sync: 10-record batches, 250ms delay, exponential backoff on 429.
Tables: user_settings, calculation_logs, saved_mappings, saved_address_pairs, processed_paddle_events, account_deletion_attempts — all RLS-protected.
Success token: --success / --success-foreground in design system.
Credit system: 50 free credits, deduct_credits RPC for atomic deduction, 402 on insufficient.

## Memories
- [Architecture](mem://features/architecture) — Edge function proxy design, CORS, batching algorithm
- [DB Schema](mem://features/db-schema) — All tables, columns, constraints, RLS policies
