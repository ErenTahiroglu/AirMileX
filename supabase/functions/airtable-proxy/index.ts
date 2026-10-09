import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  SyncAuthorizationError,
  buildPatchRecords,
  resolveAllowedFields,
  type StoredMapping,
} from "../_shared/airtable-sync.ts";
import {
  AirtableInputError,
  PatchError,
  buildBlankFieldFormula,
  clampPreviewLimit,
  syncWithBatching,
  type PatchRecord,
} from "../_shared/airtable-records.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_META = "https://api.airtable.com/v0/meta";


async function airtableFetch(url: string, pat: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new PatchError(`Airtable ${res.status}: ${body}`, res.status);
  }
  return res.json();
}

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/** Verifies the bearer token server-side; body-supplied identities are ignored. */
async function getUserIdFromAuth(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    throw new Error("Unauthorized");
  }
  return data.user.id;
}

async function getUserPat(userId: string): Promise<string> {
  const serviceClient = getServiceClient();
  const { data, error } = await serviceClient
    .from("user_settings")
    .select("airtable_pat")
    .eq("id", userId)
    .single();

  if (error || !data?.airtable_pat) {
    throw new Error("No Airtable PAT configured. Please add it in Settings.");
  }
  return data.airtable_pat;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userId = await getUserIdFromAuth(req);
    const body = await req.json();
    const { action, baseId, tableId, distanceFieldId, limit, records } = body;

    const pat = await getUserPat(userId);

    let result: unknown;

    switch (action) {
      case "whoami":
        result = await airtableFetch(`${AIRTABLE_META}/whoami`, pat);
        break;

      case "list-bases":
        result = await airtableFetch(`${AIRTABLE_META}/bases`, pat);
        break;

      case "list-tables":
        if (!baseId) throw new Error("Missing baseId");
        result = await airtableFetch(`${AIRTABLE_META}/bases/${baseId}/tables`, pat);
        break;

      case "read-records": {
        if (typeof baseId !== "string" || typeof tableId !== "string" || !baseId || !tableId) {
          throw new AirtableInputError("Missing params");
        }
        // Resolve the field ID against live metadata; formulas reference field names.
        const meta = await airtableFetch(`${AIRTABLE_META}/bases/${encodeURIComponent(baseId)}/tables`, pat) as {
          tables?: Array<{ id: string; fields: Array<{ id: string; name: string }> }>;
        };
        const table = meta.tables?.find((t) => t.id === tableId);
        if (!table) throw new AirtableInputError("Table not found in this base.");
        const formula = buildBlankFieldFormula(distanceFieldId, table.fields);
        const url = `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=${clampPreviewLimit(limit)}`;
        result = await airtableFetch(url, pat);
        break;
      }

      case "sync-records": {
        if (typeof baseId !== "string" || typeof tableId !== "string" || !Array.isArray(records) || !records.length) {
          throw new Error("Missing sync params");
        }
        if (records.length > 1000) throw new Error("Too many records");

        // Allowlist comes from the caller's own saved mapping, never from the request.
        const { data: mapping } = await getServiceClient()
          .from("saved_mappings")
          .select("table_id, distance_col_id, cost_col_id, status_col_id, purpose_col_id")
          .eq("user_id", userId)
          .eq("table_id", tableId)
          .maybeSingle();

        // Verify mapped field IDs exist in the live schema of the requested table.
        const meta = await airtableFetch(`${AIRTABLE_META}/bases/${encodeURIComponent(baseId)}/tables`, pat) as {
          tables?: Array<{ id: string; fields: Array<{ id: string }> }>;
        };
        const table = meta.tables?.find((t) => t.id === tableId);
        if (!table) throw new SyncAuthorizationError("Table not found in this base.");
        const allowed = resolveAllowedFields(
          mapping as StoredMapping | null,
          tableId,
          new Set(table.fields.map((f) => f.id)),
        );
        const patch = buildPatchRecords(records, allowed);

        // Credits are charged by distance-proxy at calculation time; sync is write-only.
        const dropped = records.length - patch.length;
        const sync = await syncWithBatching(patch, async (batch: PatchRecord[]) => {
          const res = await airtableFetch(`${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`, pat, {
            method: "PATCH",
            body: JSON.stringify({ records: batch, typecast: true }),
          }) as { records?: Array<{ id: string }> };
          return (res.records ?? []).map((r) => r.id);
        });
        // Records rejected by the allowlist are reported as failed, never silently dropped.
        const accepted = new Set(patch.map((p) => p.id));
        const rejectedIds = (records as Array<{ id?: unknown }>)
          .map((r) => (typeof r?.id === "string" ? r.id : ""))
          .filter((id) => id && !accepted.has(id));
        result = {
          ...sync,
          failed: sync.failed + dropped,
          failedIds: [...sync.failedIds, ...rejectedIds],
          errors: dropped ? [...sync.errors, `${dropped} record(s) had no writable values.`] : sync.errors,
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = (err as Error).message;
    const status = message === "Unauthorized" ? 401 : err instanceof SyncAuthorizationError ? 403 : err instanceof PatchError ? 502 : 400;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
