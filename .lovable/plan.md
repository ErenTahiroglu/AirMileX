

# Mileage Calculator App — Revised Implementation Plan

## Architecture Overview

```text
┌─────────────────────────────────────────────────────┐
│  React Client (Vite + Tailwind + shadcn/ui)         │
│                                                      │
│  Pages: / (Auth) │ /dashboard │ /settings │ /new-job │
│                                                      │
│  ALL external API calls go through Edge Functions    │
│  Client ──POST──▶ Edge Function ──▶ External API    │
└──────────────┬──────────────────────────────────────┘
               │ Supabase JS Client
               ▼
┌──────────────────────────────────────────────────────┐
│  Supabase (Lovable Cloud)                            │
│                                                      │
│  Auth: Email/Password                                │
│  Tables: user_settings, calculation_logs,            │
│          saved_mappings                               │
│  Edge Functions:                                     │
│    • airtable-proxy (meta, read, write/sync)         │
│    • distance-proxy (Google Maps / OpenRouteService)  │
└──────────────────────────────────────────────────────┘
```

---

## Phase 1: Supabase Setup & Auth

### Enable Lovable Cloud backend

### Database tables (3 migrations)

**Table 1: `user_settings`**
- `id` uuid PK → FK `auth.users(id)` ON DELETE CASCADE
- `airtable_pat` text
- `maps_api_key` text
- `maps_provider` text (CHECK: 'google' or 'openrouteservice')
- `created_at`, `updated_at`
- RLS: user can SELECT/INSERT/UPDATE own row only

**Table 2: `calculation_logs`**
- `id` uuid PK default gen_random_uuid()
- `user_id` uuid FK → `auth.users(id)` ON DELETE CASCADE, NOT NULL
- `base_id` text NOT NULL
- `table_id` text NOT NULL
- `records_processed` int NOT NULL
- `provider_used` text NOT NULL
- `created_at` timestamptz default now()
- RLS: user can SELECT/INSERT own rows only

**Table 3: `saved_mappings`**
- `id` uuid PK default gen_random_uuid()
- `user_id` uuid FK → `auth.users(id)` ON DELETE CASCADE, NOT NULL
- `table_id` text NOT NULL
- `start_col_id` text NOT NULL
- `end_col_id` text NOT NULL
- `distance_col_id` text NOT NULL
- UNIQUE(user_id, table_id)
- RLS: user can SELECT/INSERT/UPDATE/DELETE own rows only

### Auth
- Email/password signup & login on landing page (`/`)
- Auth context provider wrapping protected routes
- Redirect: unauthenticated → `/`, authenticated → `/dashboard`

---

## Phase 2: Edge Functions (CORS-safe API Proxies)

**No external API calls from the browser.** All go through Edge Functions.

### Edge Function 1: `airtable-proxy`

Handles all Airtable communication. Client sends the user's PAT + action payload. The Edge Function makes the actual request to Airtable.

**Actions (dispatched by a `action` field in the request body):**

| Action | What it does |
|--------|-------------|
| `whoami` | GET `https://api.airtable.com/v0/meta/whoami` — test PAT validity |
| `list-bases` | GET `.../meta/bases` — list user's bases |
| `list-tables` | GET `.../meta/bases/{baseId}/tables` — list tables + field schemas |
| `read-records` | GET `.../v0/{baseId}/{tableId}` with filterByFormula for empty distance field, limit 5 |
| `sync-records` | PATCH `.../v0/{baseId}/{tableId}` — **batched write with rate limiting** |

**`sync-records` batching algorithm:**
1. Accept full array of record updates from client
2. Chunk into batches of **10 records**
3. Send each batch as a PATCH request
4. Wait **250ms** between batches
5. On 429 response: exponential backoff (1s, 2s, 4s, max 3 retries)
6. Return `{ synced: number, failed: number, errors: [] }` plus per-batch progress via streaming (or a final summary)
7. Edge Function streams progress updates back to client so the UI can show "Synced X of Y"

**CORS headers** on all responses (including OPTIONS preflight):
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization, content-type, apikey, x-client-info
```

### Edge Function 2: `distance-proxy`

Handles distance calculation. Client sends addresses + provider + API key.

**Logic:**
- If `provider === 'google'`: call Google Distance Matrix API
- If `provider === 'openrouteservice'`: call ORS Directions API
- Accept a batch of address pairs, return distances
- No client-side API calls to Maps providers

**Request shape:**
```json
{
  "provider": "google",
  "api_key": "user's key",
  "pairs": [
    { "record_id": "rec123", "start": "123 Main St", "end": "456 Oak Ave" }
  ]
}
```

**Response:** `{ results: [{ record_id, distance_km, distance_mi, status }] }`

---

## Phase 3: Frontend Pages & Components

### Routing
| Route | Component | Auth |
|-------|-----------|------|
| `/` | `AuthPage` (login/register) | Public |
| `/dashboard` | `Dashboard` | Protected |
| `/settings` | `SettingsPage` | Protected |
| `/new-job` | `NewJobPage` | Protected |

### Landing / Auth Page (`/`)
- Clean login/register form with tab toggle
- Email + password fields, submit button
- Redirect to `/dashboard` on success

### Dashboard (`/dashboard`)
- Total records processed widget (query `calculation_logs` sum)
- Navigation links to Settings and New Job
- Recent sync history list

### Settings (`/settings`)
- Form: Airtable PAT (password input), Maps API Key (password input), Maps Provider (dropdown)
- Save to `user_settings` via Supabase client
- Green checkmark badges for saved keys
- "Test Airtable Connection" button → calls `airtable-proxy` with `whoami` action → toast result

### New Mileage Job (`/new-job`)
1. **Base selector** — on mount, call `airtable-proxy` `list-bases` → dropdown
2. **Table selector** — on base select, call `airtable-proxy` `list-tables` → dropdown
3. **Auto-populate mappings** — on table select, query `saved_mappings` for this `table_id`. If found, pre-fill the three column dropdowns
4. **Column mapping** — 3 dropdowns: Start Address, End Address, Distance Output (populated from table field schema)
5. **Save mapping** — upsert to `saved_mappings` when user changes columns
6. **Fetch Preview** — button fetches 5 records with empty distance field via `airtable-proxy` `read-records`, displayed in a simple table
7. **Calculate** — sends address pairs to `distance-proxy`, receives distances
8. **Sync to Airtable** — calls `airtable-proxy` `sync-records`
   - UI shows progress bar: "Synced X of Y records" (updated as batches complete)
   - On completion: write to `calculation_logs` (with `base_id` and `table_id`), show success toast

---

## Phase 4: Shared Infrastructure

### Services layer (`src/services/`)
- `airtable.ts` — functions that call `airtable-proxy` edge function
- `distance.ts` — function that calls `distance-proxy` edge function
- `settings.ts` — CRUD for `user_settings`
- `mappings.ts` — CRUD for `saved_mappings`
- `logs.ts` — read/write `calculation_logs`

### Auth (`src/contexts/AuthContext.tsx`)
- `onAuthStateChange` listener set up before `getSession()`
- Provides `user`, `session`, `signIn`, `signUp`, `signOut`

### Protected route wrapper
- Redirects to `/` if no session

---

## File Structure

```text
src/
  contexts/AuthContext.tsx
  services/airtable.ts, distance.ts, settings.ts, mappings.ts, logs.ts
  pages/AuthPage.tsx, Dashboard.tsx, SettingsPage.tsx, NewJobPage.tsx
  components/
    ProtectedRoute.tsx
    settings/SettingsForm.tsx, ConnectionBadge.tsx
    job/BaseTableSelector.tsx, ColumnMapper.tsx, RecordPreview.tsx, SyncProgress.tsx
    dashboard/StatsWidget.tsx, RecentSyncs.tsx
supabase/functions/
  airtable-proxy/index.ts
  distance-proxy/index.ts
```

---

## Security Summary

- **No direct browser calls** to Airtable, Google Maps, or OpenRouteService
- API keys sent to Edge Functions per-request (not stored in Edge Function env)
- All tables have RLS — users access only their own data
- Edge Functions validate auth token before processing
- Airtable sync uses 10-record batches + 250ms delay + exponential backoff on 429
- Input validation with zod on both client and Edge Functions

