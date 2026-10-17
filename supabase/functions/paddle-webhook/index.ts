import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import {
  processPaddleWebhookRequest,
  type PaddleFulfillmentRpcResponse,
} from "../_shared/paddle.ts";

Deno.serve(async (req) => {
  try {
    const method = req.method;
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Paddle-Signature");

    const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET");
    const priceId = Deno.env.get("PADDLE_PRICE_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ error: "Server misconfigured: database credentials missing", category: "configuration_error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const fulfillRpc = async (params: {
      eventId: string;
      transactionId: string;
      userId: string;
      credits: number;
    }) => {
      const { data, error } = await supabase.rpc("fulfill_paddle_credits", {
        p_event_id: params.eventId,
        p_transaction_id: params.transactionId,
        p_user_id: params.userId,
        p_credits: params.credits,
      });

      return {
        data: data as PaddleFulfillmentRpcResponse | null,
        error,
      };
    };

    const result = await processPaddleWebhookRequest(
      method,
      rawBody,
      signatureHeader,
      {
        paddleWebhookSecret: webhookSecret,
        paddlePriceId: priceId,
        fulfillRpc,
      }
    );

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const errorType = err instanceof Error ? err.name : "UnknownError";
    console.error(`paddle-webhook uncaught error (${errorType})`);
    return new Response(
      JSON.stringify({ error: "Internal server error", category: "internal_error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
