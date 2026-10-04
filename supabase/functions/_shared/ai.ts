// Shared helpers for cheap, cached, quota-protected AI Gateway calls.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export const AI_MODEL = "google/gemini-3.1-flash-lite";
const CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const FREE_AI_OPS_PER_DAY = 5;

export class AiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getCached(db: SupabaseClient, hash: string): Promise<string | null> {
  const { data } = await db.from("ai_cache").select("response_text").eq("prompt_hash", hash).maybeSingle();
  return data?.response_text ?? null;
}

export async function putCached(db: SupabaseClient, hash: string, feature: string, text: string) {
  await db.from("ai_cache").upsert({ prompt_hash: hash, feature_type: feature, response_text: text });
}

/**
 * Charges `count` AI operations: first from the daily free allowance, then 1 credit each.
 * Returns the number of credits reserved so callers can refund on failure.
 */
export async function chargeAiOps(db: SupabaseClient, userId: string, count: number): Promise<number> {
  if (count <= 0) return 0;
  const day = new Date().toISOString().slice(0, 10);
  let paid = 0;
  for (let i = 0; i < count; i++) {
    const { data: free } = await db.rpc("consume_quick_distance_quota", {
      p_bucket_key: `ai_free:${userId}:${day}`,
      p_limit: FREE_AI_OPS_PER_DAY,
      p_window_seconds: 86400,
    });
    if (free !== true) {
      paid = count - i;
      break;
    }
  }
  if (paid > 0) {
    const { error } = await db.rpc("reserve_credits", { p_user_id: userId, p_amount: paid });
    if (error) {
      throw new AiError(
        `Your ${FREE_AI_OPS_PER_DAY} free AI actions for today are used up and you don't have enough credits.`,
        402,
      );
    }
  }
  return paid;
}

export async function refundCredits(db: SupabaseClient, userId: string, amount: number) {
  if (amount > 0) await db.rpc("refund_credits", { p_user_id: userId, p_amount: amount });
}

/** One short JSON-mode completion with tight output limits. */
export async function completeJson(system: string, user: string): Promise<unknown> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new AiError("AI is not configured.", 500);
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      max_tokens: 150,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`AI gateway failed [${res.status}]: ${detail}`);
    if (res.status === 429) throw new AiError("The AI service is busy. Please try again in a minute.", 429);
    if (res.status === 402) throw new AiError("AI credits are used up for this workspace.", 402);
    throw new AiError("The AI service is unavailable right now.", 502);
  }
  const body = await res.json();
  const text: string = body?.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AiError("The AI returned an unreadable result.", 502);
  }
}

export async function requireUser(db: SupabaseClient, req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user?.id ?? null;
}
