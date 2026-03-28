import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AIRTABLE_API = "https://api.airtable.com/v0";
const AIRTABLE_META = "https://api.airtable.com/v0/meta";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    throw new Error(`Airtable ${res.status}: ${body}`);
  }
  return res.json();
}

async function syncWithBatching(
  pat: string,
  baseId: string,
  tableId: string,
  distanceFieldId: string,
  records: { id: string; value: string }[]
) {
  const BATCH_SIZE = 10;
  const DELAY_MS = 250;
  const MAX_RETRIES = 3;

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const payload = {
      records: batch.map((r) => ({
        id: r.id,
        fields: { [distanceFieldId]: r.value },
      })),
    };

    let attempt = 0;
    let success = false;

    while (attempt < MAX_RETRIES && !success) {
      try {
        await airtableFetch(`${AIRTABLE_API}/${baseId}/${tableId}`, pat, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        synced += batch.length;
        success = true;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") && attempt < MAX_RETRIES - 1) {
          const backoff = Math.pow(2, attempt) * 1000;
          await sleep(backoff);
          attempt++;
        } else {
          failed += batch.length;
          errors.push(`Batch at index ${i}: ${msg}`);
          break;
        }
      }
    }

    if (i + BATCH_SIZE < records.length) {
      await sleep(DELAY_MS);
    }
  }

  return { synced, failed, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, pat, baseId, tableId, distanceFieldId, limit, records } = await req.json();

    if (!pat) {
      return new Response(JSON.stringify({ error: "Missing PAT" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        if (!baseId || !tableId || !distanceFieldId) throw new Error("Missing params");
        const formula = `IF({${distanceFieldId}}=BLANK(),TRUE(),FALSE())`;
        const url = `${AIRTABLE_API}/${baseId}/${tableId}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=${limit || 5}`;
        result = await airtableFetch(url, pat);
        break;
      }

      case "sync-records": {
        if (!baseId || !tableId || !distanceFieldId || !records?.length) {
          throw new Error("Missing sync params");
        }
        result = await syncWithBatching(pat, baseId, tableId, distanceFieldId, records);
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
