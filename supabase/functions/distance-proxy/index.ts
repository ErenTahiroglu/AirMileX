import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/cors.ts";
import {
  ProviderError,
  fetchWithTimeout,
  geoapifyGeocode,
  geoapifyRoute,
  httpError,
  nominatimGeocode,
  orsGeocode,
  orsRoute,
  osrmRoute,
  parseCoordinates,
  runChain,
  statusIsRetryable,
  type LonLat,
  type RouteSummary,
} from "../_shared/geo.ts";

import {
  planGeocodeProviders,
  planRouteProviders,
  validateBulkProviderConfig,
  type BulkProviderConfig,
} from "../_shared/bulk-distance-providers.ts";

const SERVER_GEOAPIFY_KEY = Deno.env.get("GEOAPIFY_API_KEY") ?? "";
const SERVER_ORS_KEY = Deno.env.get("OPENROUTESERVICE_API_KEY") ?? "";

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
}

/** Google distance matrix, with its own status codes mapped to our error model. */
async function googleDistance(apiKey: string, start: string, end: string): Promise<RouteSummary> {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(start)}&destinations=${encodeURIComponent(end)}&key=${apiKey}`;
  const res = await fetchWithTimeout("Google", url);
  if (!res.ok) throw httpError("Google", res.status);
  const data = await res.json();
  if (data.status && statusIsRetryable(0) === false && data.status === "OVER_QUERY_LIMIT") {
    throw new ProviderError("Google quota exceeded", true);
  }
  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status === "OK") {
    return { distance_m: element.distance.value, duration_s: element.duration?.value ?? 0 };
  }
  // ZERO_RESULTS / NOT_FOUND are bad user input, never a reason to fail over.
  throw new ProviderError("Address not found", false);
}

type Provider = "google" | "openrouteservice" | "geoapify";

interface Keys {
  provider: Provider;
  userKey: string;
}

function geocodeAttempts(config: BulkProviderConfig, address: string): Array<() => Promise<LonLat>> {
  const plan = planGeocodeProviders(config);
  const attempts: Array<() => Promise<LonLat>> = [];
  for (const p of plan) {
    if (p === "nominatim") attempts.push(() => nominatimGeocode(address));
    else if (p === "operator_geoapify" && config.operatorGeoapifyKey) attempts.push(() => geoapifyGeocode(config.operatorGeoapifyKey!, address));
    else if (p === "operator_ors" && config.operatorOrsKey) attempts.push(() => orsGeocode(config.operatorOrsKey!, address));
    else if (p === "user_geoapify" && config.userKey) attempts.push(() => geoapifyGeocode(config.userKey!, address));
    else if (p === "user_ors" && config.userKey) attempts.push(() => orsGeocode(config.userKey!, address));
  }
  return attempts;
}

function routeAttempts(config: BulkProviderConfig, start: LonLat, end: LonLat): Array<() => Promise<RouteSummary>> {
  const plan = planRouteProviders(config);
  const attempts: Array<() => Promise<RouteSummary>> = [];
  for (const p of plan) {
    if (p === "osrm") attempts.push(() => osrmRoute(start, end));
    else if (p === "operator_geoapify" && config.operatorGeoapifyKey) attempts.push(() => geoapifyRoute(config.operatorGeoapifyKey!, start, end));
    else if (p === "operator_ors" && config.operatorOrsKey) attempts.push(() => orsRoute(config.operatorOrsKey!, start, end));
    else if (p === "user_geoapify" && config.userKey) attempts.push(() => geoapifyRoute(config.userKey!, start, end));
    else if (p === "user_ors" && config.userKey) attempts.push(() => orsRoute(config.userKey!, start, end));
  }
  return attempts;
}

async function resolvePair(
  config: BulkProviderConfig,
  pair: AddressPair,
  geocodeCache: Map<string, LonLat>
): Promise<RouteSummary> {
  // User Google API key is only for single mode
  if (!config.isBulk && config.userProvider === "google" && config.userKey) {
    try {
      return await googleDistance(config.userKey, pair.start, pair.end);
    } catch (err) {
      if (err instanceof ProviderError && !err.retryable) throw err;
    }
  }

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

  try {
    const body = await req.json();
    const pairs = body.pairs;
    const isBulk = Boolean(body.is_bulk ?? body.isBulk);

    if (!Array.isArray(pairs) || pairs.length === 0) {
      return json({ error: "Missing pairs" }, 400);
    }
    if (pairs.length > 500) {
      return json({ error: "Too many rows in one batch (max 500)." }, 400);
    }

    // Settings are always read for the verified user id, never a body-supplied id.
    const { data: settings } = await serviceClient
      .from("user_settings")
      .select("maps_api_key, maps_provider")
      .eq("id", userId)
      .single();

    const config: BulkProviderConfig = {
      isBulk,
      operatorGeoapifyKey: SERVER_GEOAPIFY_KEY,
      operatorOrsKey: SERVER_ORS_KEY,
      userProvider: (settings?.maps_provider as Provider) || "geoapify",
      userKey: (settings?.maps_api_key as string) || "",
    };

    const validation = validateBulkProviderConfig(config);
    if (!validation.valid) {
      return json({ error: validation.error ?? "Invalid provider configuration" }, 400);
    }

    // Atomically reserve credits up-front (row-level locked UPDATE) to avoid races.
    const { error: reserveErr } = await serviceClient.rpc("reserve_credits", {
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
    const results: DistanceResult[] = [];
    for (const pair of pairs as AddressPair[]) {
      try {
        const route = await resolvePair(config, pair, geocodeCache);
        results.push({
          record_id: pair.record_id,
          distance_km: route.distance_m / 1000,
          distance_mi: route.distance_m / 1609.344,
          status: "ok",
        });
      } catch (err) {
        results.push({
          record_id: pair.record_id,
          distance_km: 0,
          distance_mi: 0,
          status: "error",
          error: (err as Error).message,
        });
      }
    }

    // Compensating refund for rows that produced no usable distance.
    const failed = results.filter((r) => r.status === "error").length;
    let creditsRemaining: number | undefined;
    if (failed > 0) {
      const { data: refunded } = await serviceClient.rpc("refund_credits", {
        p_user_id: userId,
        p_amount: failed,
      });
      if (typeof refunded === "number") creditsRemaining = refunded;
    }
    reserved = 0;

    return json({ results, credits_remaining: creditsRemaining });
  } catch (err) {
    // Full compensation when the batch never completed.
    if (reserved > 0) {
      await serviceClient.rpc("refund_credits", { p_user_id: userId, p_amount: reserved });
    }
    return json({ error: (err as Error).message }, 400);
  }
});
