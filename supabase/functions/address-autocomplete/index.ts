import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, isTrustedRequest } from "../_shared/cors.ts";
import {
  ProviderError,
  geoapifyAutocomplete,
  nominatimAutocomplete,
  orsAutocomplete,
  runChain,
  type AddressSuggestion,
} from "../_shared/geo.ts";

const GEOAPIFY_KEY = Deno.env.get("GEOAPIFY_API_KEY") ?? "";
const ORS_KEY = Deno.env.get("OPENROUTESERVICE_API_KEY") ?? "";

/** Suggestions are cheap but chatty: keep a tight per-IP ceiling. */
const IP_LIMIT_PER_MINUTE = 30;
const PAID_LIMIT_PER_DAY = 1000;

type Db = ReturnType<typeof createClient>;

async function consumeQuota(db: Db, bucketKey: string, limit: number, windowSeconds: number) {
  const { data, error } = await db.rpc("consume_quick_distance_quota", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) return false;
  return data === true;
}

async function hashIp(ip: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buffer))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isTrustedRequest(req)) {
    return json({ error: "Requests from this origin are not allowed." }, 403);
  }

  try {
    const { query } = await req.json();
    if (typeof query !== "string" || query.trim().length < 3) {
      return json({ suggestions: [] });
    }
    if (query.length > 200) {
      return json({ error: "Search text is too long." }, 400);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const clientIp =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-real-ip") ??
      (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const ipHash = await hashIp(clientIp);

    const allowed = await consumeQuota(db, `ac-min:${ipHash}`, IP_LIMIT_PER_MINUTE, 60);
    if (!allowed) {
      return json({ error: "Too many searches. Please slow down." }, 429, { "Retry-After": "60" });
    }

    const text = query.trim();
    const attempts: Array<() => Promise<AddressSuggestion[]>> = [];
    if (
      (GEOAPIFY_KEY || ORS_KEY) &&
      (await consumeQuota(db, "ac-paid", PAID_LIMIT_PER_DAY, 86400))
    ) {
      if (GEOAPIFY_KEY) attempts.push(() => geoapifyAutocomplete(GEOAPIFY_KEY, text));
      if (ORS_KEY) attempts.push(() => orsAutocomplete(ORS_KEY, text));
    }
    attempts.push(() => nominatimAutocomplete(text));

    const suggestions = await runChain(attempts);
    return json({ suggestions: suggestions.filter((s) => s.label).slice(0, 5) });
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable) {
      return json({ suggestions: [] });
    }
    return json({ suggestions: [] });
  }
});
