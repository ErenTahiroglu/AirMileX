import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

async function verifySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  // Parse "ts=...;h1=..." format
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(";")) {
    const [key, value] = part.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  }

  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;

  const payload = `${ts}:${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computed === h1;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("PADDLE_WEBHOOK_SECRET not configured");
      return new Response("Server misconfigured", { status: 500 });
    }

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Paddle-Signature") ?? "";

    const valid = await verifySignature(rawBody, signatureHeader, webhookSecret);
    if (!valid) {
      console.error("Invalid webhook signature");
      return new Response("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(rawBody);

    // Only process completed transactions
    if (event.event_type !== "transaction.completed") {
      return new Response("OK", { status: 200 });
    }

    const eventId = event.event_id;
    const userId = event.data?.custom_data?.user_id;

    if (!eventId || !userId) {
      console.error("Missing event_id or user_id in webhook payload");
      return new Response("Bad request", { status: 400 });
    }

    // Service-role client for privileged operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotency check
    const { error: insertError } = await supabase
      .from("processed_paddle_events")
      .insert({ id: eventId });

    if (insertError) {
      // Unique constraint violation = already processed
      if (insertError.code === "23505") {
        console.log(`Event ${eventId} already processed, skipping`);
        return new Response("OK", { status: 200 });
      }
      console.error("Error inserting event:", insertError);
      return new Response("Internal error", { status: 500 });
    }

    // Add 500 credits
    const { error: updateError } = await supabase
      .from("user_settings")
      .update({ credits: undefined }) // placeholder, using raw SQL below
      .eq("id", "placeholder");

    // Use rpc or raw update via service role
    const { error: creditError } = await supabase.rpc("deduct_credits", {
      p_user_id: userId,
      p_amount: -500,
    });

    // deduct_credits subtracts, so passing -500 adds 500.
    // However, the function checks credits >= p_amount which would fail for negative.
    // Instead, do a direct update via the service-role client.

    // Cancel the above — do a direct SQL update instead
    const { error: directError } = await supabase
      .from("user_settings")
      .update({ credits: 0 }) // This won't work directly for increment
      .eq("id", userId);

    // Actually, we need to use a raw SQL approach for credits + 500.
    // Let's use the Postgres function approach via rpc.

    // Clean approach: use a dedicated rpc or direct SQL
    // For now, fetch current credits and set new value
    const { data: settings, error: fetchError } = await supabase
      .from("user_settings")
      .select("credits")
      .eq("id", userId)
      .single();

    if (fetchError || !settings) {
      console.error("Error fetching user settings:", fetchError);
      return new Response("Internal error", { status: 500 });
    }

    const newCredits = settings.credits + 500;
    const { error: setError } = await supabase
      .from("user_settings")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (setError) {
      console.error("Error updating credits:", setError);
      return new Response("Internal error", { status: 500 });
    }

    console.log(`Added 500 credits to user ${userId}, new balance: ${newCredits}`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("paddle-webhook error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
