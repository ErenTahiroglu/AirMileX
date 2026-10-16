import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  ProviderError,
  geoapifyGeocode,
  geoapifyRoute,
  parseCoordinates,
  runChain,
  type LonLat,
  type RouteSummary,
} from "../_shared/geo.ts";

import {
  planGeocodeProviders,
  planRouteProviders,
  planRefundCompensation,
  executeCreditRefund,
  validateBulkProviderConfig,
  type BulkProviderConfig,
} from "../_shared/bulk-distance-providers.ts";

const SERVER_GEOAPIFY_KEY = Deno.env.get("GEOAPIFY_API_KEY") ?? "";

interface AddressPair {
  record_id: string;
  start: string;
  end: string;
}

interface DistanceResult {
  record_id: string;
  distance_km: number;
  distance_mi: number;
  status: "ok" | "error";
  error?: string;
  error_type?: "not_found" | "provider";
}

function geocodeAttempts(config: BulkProviderConfig, address: string): Array<() => Promise<LonLat>> {
  const plan = planGeocodeProviders(config);
  const attempts: Array<() => Promise<LonLat>> = [];
  for (const p of plan) {
    if (p === "operator_geoapify" && config.operatorGeoapifyKey) {
      attempts.push(() => geoapifyGeocode(config.operatorGeoapifyKey!, address));
    }
  }
  return attempts;
}

function routeAttempts(config: BulkProviderConfig, start: LonLat, end: LonLat): Array<() => Promise<RouteSummary>> {
  const plan = planRouteProviders(config);
  const attempts: Array<() => Promise<RouteSummary>> = [];
  for (const p of plan) {
    if (p === "operator_geoapify" && config.operatorGeoapifyKey) {
      attempts.push(() => geoapifyRoute(config.operatorGeoapifyKey!, start, end));
    }
  }
  return attempts;
}

async function resolvePair(
  config: BulkProviderConfig,
  pair: AddressPair,
  geocodeCache: Map<string, LonLat>
): Promise<RouteSummary> {
  const getCoordinates = async (address: string): Promise<LonLat> => {
    const parsed = parseCoordinates(address);
    if (parsed) return parsed;
    const normalized = address.trim().toLowerCase();
    if (geocodeCache.has(normalized)) {
      return geocodeCache.get(normalized)!;
    }
    const coords = await runChain(geocodeAttempts(config, address));
    geocodeCache.set(normalized, coords);
    return coords;
  };

  const startCoords = await getCoordinates(pair.start);
  const endCoords = await getCoordinates(pair.end);
  return await runChain(routeAttempts(config, startCoords, endCoords));
}

/** Verifies the bearer token and returns the authenticated user id. */

async function getAuthenticatedUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) throw new Error("Unauthorized");
  return data.user.id;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let userId: string;
  try {
    userId = await getAuthenticatedUserId(req);
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let reserved = 0;
  const results: DistanceResult[] = [];
  let pairs: AddressPair[] = [];

  try {
    const body = await req.json();
    pairs = body.pairs;
    const isBulk = Boolean(body.is_bulk ?? body.isBulk);

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return json({ error: "Missing pairs" }, 400);
    }
    if (pairs.length > 500) {
      return json({ error: "Too many rows in one batch (max 500)." }, 400);
    }

    const config: BulkProviderConfig = {
      isBulk,
      operatorGeoapifyKey: SERVER_GEOAPIFY_KEY,
    };

    const validation = validateBulkProviderConfig(config);
    if (!validation.valid) {
      return json({ error: validation.error ?? "Operator map service is not configured" }, 400);
    }

    // Atomically reserve credits up-front (row-level locked UPDATE) to avoid races.
    const { data: reservedBalance, error: reserveErr } = await serviceClient.rpc("reserve_credits", {
      p_user_id: userId,
      p_amount: pairs.length,
    });

    if (reserveErr) {
      if ((reserveErr.message || "").includes("Insufficient credits")) {
        const { data: cur } = await serviceClient
          .from("user_settings")
          .select("credits")
          .eq("id", userId)
          .single();
        return json(
          { error: "Insufficient credits", credits_available: cur?.credits ?? 0 },
          402
        );
      }
      throw new Error(`Credit reservation failed: ${reserveErr.message}`);
    }
    reserved = pairs.length;

    const geocodeCache = new Map<string, LonLat>();
    for (const pair of pairs) {
      try {
        const route = await resolvePair(config, pair, geocodeCache);
        results.push({
          record_id: pair.record_id,
          distance_km: route.distance_m / 1000,
          distance_mi: route.distance_m / 1609.344,
          status: "ok",
        });
      } catch (err) {
        const isNotFound =
          err instanceof ProviderError
            ? err.kind === "address"
            : (err as Error).message.toLowerCase().includes("not found");
        results.push({
          record_id: pair.record_id,
          distance_km: 0,
          distance_mi: 0,
          status: "error",
          error: (err as Error).message,
          error_type: isNotFound ? "not_found" : "provider",
        });
      }
    }

    // Compensating refund for rows that produced no usable distance.
    const failed = results.filter((r) => r.status === "error").length;
    let creditsRemaining: number | undefined;
    let refundError: string | undefined;

    if (failed > 0) {
      const refundResult = await executeCreditRefund(serviceClient, userId, failed);
      if (!refundResult.refunded) {
        refundError = refundResult.refundError;
      } else {
        creditsRemaining = refundResult.creditsRemaining;
      }
    } else {
      // Fully successful batch: authoritative balance returned by reserve_credits
      if (typeof reservedBalance === "number") {
        creditsRemaining = reservedBalance;
      }
    }

    // If creditsRemaining is still unknown for any reason, fetch authoritative balance from DB
    if (typeof creditsRemaining !== "number") {
      const { data: cur } = await serviceClient
        .from("user_settings")
        .select("credits")
        .eq("id", userId)
        .single();
      if (cur && typeof cur.credits === "number") {
        creditsRemaining = cur.credits;
      }
    }

    reserved = 0;

    return json({
      results,
      credits_remaining: creditsRemaining,
      ...(refundError ? { refund_error: refundError } : {}),
    });
  } catch (err) {
    // Compensation when the batch never completed.
    // Ensure compensation logic cannot accidentally refund successful calculations as though the entire batch failed.
    const succeeded = results.filter((r) => r.status === "ok").length;
    const plan = planRefundCompensation(pairs.length || reserved, succeeded);
    let compensationRefundError: string | undefined;

    if (plan.amountToRefund > 0 && reserved > 0) {
      const refundResult = await executeCreditRefund(serviceClient, userId, plan.amountToRefund);
      if (!refundResult.refunded) {
        compensationRefundError = refundResult.refundError;
      }
    }
    reserved = 0;

    return json(
      {
        error:
          (err as Error).message +
          (compensationRefundError ? ` (${compensationRefundError})` : ""),
      },
      400
    );
  }

});
