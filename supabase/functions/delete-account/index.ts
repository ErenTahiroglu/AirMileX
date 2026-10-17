import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { executeAccountDeletion } from "../_shared/account-deletion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let userId: string | null = null;

  const logAttempt = async (status: string, errorMessage?: string) => {
    if (!userId) return;
    await admin.from("account_deletion_attempts").insert({
      user_id: userId,
      status,
      error_message: errorMessage ?? null,
    });
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the caller's identity using their JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    userId = userData.user.id;

    const result = await executeAccountDeletion(userId, {
      checkRateLimit: async (uid) => {
        const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
        const { data: recent, error: recentErr } = await admin
          .from("account_deletion_attempts")
          .select("attempted_at")
          .eq("user_id", uid)
          .gte("attempted_at", since)
          .order("attempted_at", { ascending: false })
          .limit(1);

        if (recentErr) {
          return { rateLimited: false, error: recentErr.message };
        }

        if (recent && recent.length > 0) {
          const last = new Date(recent[0].attempted_at).getTime();
          const retryAfterSec = Math.max(
            1,
            Math.ceil((last + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000)
          );
          return { rateLimited: true, retryAfterSec };
        }

        return { rateLimited: false };
      },
      deleteAuthUser: async (uid) => {
        return await admin.auth.admin.deleteUser(uid);
      },
      deleteCalculationLogs: async (uid) => {
        const { error } = await admin.from("calculation_logs").delete().eq("user_id", uid);
        return { error };
      },
      deleteSavedAddressPairs: async (uid) => {
        const { error } = await admin.from("saved_address_pairs").delete().eq("user_id", uid);
        return { error };
      },
      deleteSavedMappings: async (uid) => {
        const { error } = await admin.from("saved_mappings").delete().eq("user_id", uid);
        return { error };
      },
      deleteUserSettings: async (uid) => {
        const { error } = await admin.from("user_settings").delete().eq("id", uid);
        return { error };
      },
      logAttempt,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...(result.headers ?? {}),
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    await logAttempt("error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
