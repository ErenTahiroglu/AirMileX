import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { executeAccountDeletion, sanitizeErrorMessage } from "../_shared/account-deletion.ts";

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
    const sanitizedError = sanitizeErrorMessage(errorMessage);
    await admin.from("account_deletion_attempts").insert({
      user_id: userId,
      status,
      error_message: sanitizedError,
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

    // Parse step-up verification code from request payload if present
    let otpCode: string | undefined = undefined;
    if (req.method === "POST") {
      try {
        const text = await req.text();
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.otp_code === "string") {
            otpCode = parsed.otp_code;
          }
        }
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

    const result = await executeAccountDeletion(
      userId,
      {
        verifyStepUp: async (uid, email, code) => {
          if (!code || typeof code !== "string" || code.trim().length !== 6) {
            return { verified: false, error: "Step-up verification code must be 6 digits" };
          }
          if (!email) {
            return { verified: false, error: "No email associated with account" };
          }

          // Brute-force protection: check if there are >= 5 failed attempts in the last 15 minutes
          const recentFailedSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
          const { count: failedCount } = await admin
            .from("account_deletion_attempts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", uid)
            .eq("status", "unauthorized")
            .gte("attempted_at", recentFailedSince);

          if (failedCount && failedCount >= 5) {
            return {
              verified: false,
              error: "Too many failed verification attempts. Please wait 15 minutes before trying again.",
            };
          }

          // Verify the OTP via Supabase Auth
          const authClient = createClient(supabaseUrl, anonKey);
          const { data: verifyData, error: verifyErr } = await authClient.auth.verifyOtp({
            email,
            token: code.trim(),
            type: "email",
          });

          if (verifyErr || !verifyData.user || verifyData.user.id !== uid) {
            return {
              verified: false,
              error: verifyErr?.message || "User ID mismatch during verification",
            };
          }

          return { verified: true };
        },
        checkRateLimit: async (uid) => {
          const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
          // Rate-limiting applies to actual deletion attempts (success, error, partial_failure).
          // Failed OTP attempts (unauthorized) do not lock legitimate users out for 1 hour.
          const { data: recent, error: recentErr } = await admin
            .from("account_deletion_attempts")
            .select("attempted_at")
            .eq("user_id", uid)
            .neq("status", "unauthorized")
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
      },
      {
        userEmail: userData.user.email,
        otpCode,
      }
    );

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        ...(result.headers ?? {}),
      },
    });
  } catch (err: unknown) {
    const errorType = err instanceof Error ? err.name : "UnknownError";
    console.error(`delete-account uncaught error (${errorType})`);
    if (userId) {
      await logAttempt("error", `uncaught-exception: ${errorType}`);
    }
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred during account deletion" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
