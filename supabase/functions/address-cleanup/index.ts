import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { AiError, chargeAiOps, completeJson, getCached, putCached, refundCredits, sha256 } from "../_shared/ai.ts";
import { geoapifyGeocode, nominatimGeocode, runChain, type LonLat } from "../_shared/geo.ts";
import { createLovableAiGatewayRunIdFetch, getLovableAiGatewayRunId } from "./run-id.ts";

const MODEL = "openai/gpt-6-astra";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const USER_LIMIT_PER_HOUR = 30;

const INSTRUCTIONS = `You turn rough trip location notes into clear, geocoding-ready postal addresses.
Return ONLY a JSON object: {"start":{"address":string,"confidence":"high"|"medium"|"low","note":string},"end":{...same}}.
Rules: keep the user's intended place; expand abbreviations; add city, region and country when they can be reasonably inferred (use the other note as context).
Never invent house numbers or street names that are not implied. If a note is too vague, return the best general place (e.g. "Kadıköy, Istanbul, Türkiye") with confidence "low" and a short note on what is missing. "note" is at most 15 words, empty when confident.`;

interface CleanAddress {
  address: string;
  confidence: "high" | "medium" | "low";
  note: string;
}

const isClean = (v: unknown): v is CleanAddress => {
  const o = v as Record<string, unknown>;
  return (
    !!o &&
    typeof o.address === "string" &&
    o.address.trim().length > 0 &&
    ["high", "medium", "low"].includes(o.confidence as string) &&
    typeof o.note === "string"
  );
};

/** Reads the gateway SSE stream and returns the final output text. */
async function readStreamText(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === "response.output_text.delta") text += event.delta ?? "";
        if (event.type === "error" || event.type === "response.failed") {
          throw new Error(event.error?.message ?? event.response?.error?.message ?? "AI request failed");
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  return text;
}

const FIX_SYSTEM = `You correct street addresses that a map search could not find (typos, missing city, wrong order, abbreviations).
Return ONLY {"start":[string],"end":[string]} with 1-2 corrected variants each, most likely first.
Only fix spelling/format and add city/region/country implied by the other address. Never invent house numbers or new streets.`;

interface VerifiedAddress { address: string; lat: number; lon: number }

async function verify(address: string): Promise<VerifiedAddress | null> {
  const key = Deno.env.get("GEOAPIFY_API_KEY");
  const attempts: Array<() => Promise<LonLat>> = [() => nominatimGeocode(address)];
  if (key) attempts.push(() => geoapifyGeocode(key, address));
  try {
    const [lon, lat] = await runChain(attempts);
    return { address, lat, lon };
  } catch {
    return null;
  }
}

const toList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 2) : [];

/** Suggests map-verified corrections for an address pair that failed geocoding. */
async function handleFix(db: ReturnType<typeof createClient>, userId: string, start: string, end: string) {
  const hash = await sha256(`fix:v1:${start.toLowerCase()}|${end.toLowerCase()}`);
  const cached = await getCached(db, hash);
  let raw: { start: string[]; end: string[] };
  if (cached) {
    raw = JSON.parse(cached);
  } else {
    const reserved = await chargeAiOps(db, userId, 1);
    try {
      const out = (await completeJson(FIX_SYSTEM, `Start: ${start}\nEnd: ${end}`)) as Record<string, unknown>;
      raw = { start: toList(out.start), end: toList(out.end) };
      await putCached(db, hash, "fix_address", JSON.stringify(raw));
    } catch (err) {
      await refundCredits(db, userId, reserved);
      throw err;
    }
  }
  const check = async (list: string[]) => (await Promise.all(list.map(verify))).filter((v): v is VerifiedAddress => !!v);
  const [s, e] = await Promise.all([check(raw.start), check(raw.end)]);
  return { start: s, end: e };
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userData } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "Please sign in to use the address cleaner." }, 401);

  let start: string, end: string, mode: string;
  try {
    const body = await req.json();
    mode = body.mode === "fix" ? "fix" : "clean";
    start = typeof body.start === "string" ? body.start.trim() : "";
    end = typeof body.end === "string" ? body.end.trim() : "";
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (!start || !end) return json({ error: "Enter both a start and an end note." }, 400);
  if (start.length > 300 || end.length > 300) return json({ error: "Notes must be under 300 characters." }, 400);

  if (mode === "fix") {
    try {
      return json(await handleFix(db, userId, start, end));
    } catch (err) {
      const e = err as AiError;
      return json({ error: e.message || "Could not suggest corrections." }, e.status ?? 500);
    }
  }

  const { data: allowed } = await db.rpc("consume_quick_distance_quota", {
    p_bucket_key: `cleanup:${userId}`,
    p_limit: USER_LIMIT_PER_HOUR,
    p_window_seconds: 3600,
  });
  if (allowed !== true) {
    return json({ error: "Hourly limit reached. Please try again later." }, 429, { "Retry-After": "3600" });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return json({ error: "AI is not configured." }, 500);

  const gateway = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(req));
  let res: Response;
  try {
    res = await gateway.fetch(GATEWAY_URL, {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: MODEL,
        instructions: INSTRUCTIONS,
        input: `Start note: ${start}\nEnd note: ${end}`,
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        text: { format: { type: "json_object" } },
      }),
    });
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499, headers: corsHeaders });
    return json({ error: (err as Error).message }, 502);
  }

  if (!res.ok) {
    const detail = await res.text();
    let message = "The AI service is unavailable right now.";
    try {
      message = JSON.parse(detail)?.error?.message ?? JSON.parse(detail)?.message ?? message;
    } catch { /* keep default */ }
    if (res.status === 402) message = "AI credits are used up for this workspace. " + message;
    const extra: Record<string, string> = {};
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) extra["Retry-After"] = retryAfter;
    return json({ error: message }, res.status, extra);
  }

  try {
    const text = await readStreamText(res);
    if (!text.trim()) return json({ error: "The AI returned no result. Try more detailed notes." }, 502);
    const parsed = JSON.parse(text);
    if (!isClean(parsed.start) || !isClean(parsed.end)) {
      return json({ error: "The AI result was incomplete. Try more detailed notes." }, 502);
    }
    return json({ start: parsed.start, end: parsed.end });
  } catch (err) {
    return json({ error: (err as Error).message || "Could not read the AI result." }, 502);
  }
});
