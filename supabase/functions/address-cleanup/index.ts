import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
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

  let start: string, end: string;
  try {
    const body = await req.json();
    start = typeof body.start === "string" ? body.start.trim() : "";
    end = typeof body.end === "string" ? body.end.trim() : "";
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (!start || !end) return json({ error: "Enter both a start and an end note." }, 400);
  if (start.length > 300 || end.length > 300) return json({ error: "Notes must be under 300 characters." }, 400);

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
