import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  AiError, chargeAiOps, completeJson, getCached, putCached, refundCredits, requireUser, sha256,
} from "../_shared/ai.ts";

const MAX_NOTES = 500;
const SYSTEM = `You write business purposes for mileage logs that meet IRS Publication 463 substantiation standards.
Given a short trip note, return ONLY {"purpose": string}: one factual sentence (max 25 words) naming the business activity and who/what it involved.
Use only facts in the note; never invent names, amounts or places. Write in English.`;

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userId = await requireUser(db, req);
  if (!userId) return json({ error: "Please sign in first." }, 401);

  let notes: string[];
  try {
    const body = await req.json();
    notes = Array.isArray(body.notes) ? body.notes.map((n: unknown) => (typeof n === "string" ? n : "")) : [];
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (notes.length === 0 || notes.length > MAX_NOTES) return json({ error: `Send 1 to ${MAX_NOTES} notes.` }, 400);
  if (notes.some((n) => n.length > 300)) return json({ error: "Each note must be under 300 characters." }, 400);

  // Unique non-empty notes; cached ones are free.
  const unique = [...new Set(notes.map(normalize).filter(Boolean))];
  const results = new Map<string, string>();
  const missing: { key: string; hash: string }[] = [];
  for (const key of unique) {
    const hash = await sha256(`purpose:v1:${key}`);
    const hit = await getCached(db, hash);
    if (hit) results.set(key, hit);
    else missing.push({ key, hash });
  }

  let reserved = 0;
  try {
    reserved = await chargeAiOps(db, userId, missing.length);
  } catch (err) {
    const e = err as AiError;
    return json({ error: e.message }, e.status ?? 500);
  }

  for (const { key, hash } of missing) {
    try {
      const out = (await completeJson(SYSTEM, `Trip note: ${key}`)) as { purpose?: unknown };
      const purpose = typeof out.purpose === "string" ? out.purpose.trim() : "";
      if (!purpose) throw new Error("empty");
      results.set(key, purpose);
      await putCached(db, hash, "purpose", purpose);
    } catch (err) {
      if (err instanceof AiError && err.status === 429) break;
    }
  }
  // Refund credits for notes that produced nothing (never more than reserved).
  const produced = missing.filter((m) => results.has(m.key)).length;
  await refundCredits(db, userId, Math.min(reserved, missing.length - produced));

  return json({ purposes: notes.map((n) => results.get(normalize(n)) ?? null) });
});
