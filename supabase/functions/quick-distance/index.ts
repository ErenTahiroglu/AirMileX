import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, isTrustedRequest } from "../_shared/cors.ts";
import {
  ProviderError,
  nominatimGeocode,
  osrmRoute,
  parseCoordinates,
  runChain,
  type LonLat,
  type RouteSummary,
} from "../_shared/geo.ts";

// Public endpoint: free hard-coded providers only (see _shared/quick-distance-providers.ts).

/** Abuse controls for this intentionally public endpoint. */
const IP_LIMIT_PER_MINUTE = 5;
const IP_LIMIT_PER_HOUR = 20;
const GLOBAL_LIMIT_PER_DAY = 2000;

type Db = ReturnType<typeof createClient>;

const normalizeKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Atomic counter in the database; returns false once the bucket is over its limit. */
async function consumeQuota(
  db: Db,
  bucketKey: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await db.rpc("consume_quick_distance_quota", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  // Fail closed: if the counter is unavailable we do not hand out free provider calls.
  if (error) return false;
  return data === true;
}

async function hashIp(ip: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buffer))
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Cache -> Nominatim. Stops early on bad addresses. */
async function resolveAddress(db: Db, address: string): Promise<LonLat> {
  const direct = parseCoordinates(address);
  if (direct) return direct;

  const key = normalizeKey(address);
  const { data: cached } = await db
    .from("geocode_cache")
    .select("lat, lon")
    .eq("query_key", key)
    .maybeSingle();
  if (cached) return [cached.lon as number, cached.lat as number];

  const attempts: Array<() => Promise<LonLat>> = [() => nominatimGeocode(address)];

  const coords = await runChain(attempts);

  await db
    .from("geocode_cache")
    .upsert({ query_key: key, lat: coords[1], lon: coords[0], label: address });

  return coords;
}

async function resolveRoute(
  db: Db,
  start: LonLat,
  end: LonLat
): Promise<RouteSummary> {
  const key = [round6(start[0]), round6(start[1]), round6(end[0]), round6(end[1])].join(",");
  const { data: cached } = await db
    .from("route_cache")
    .select("distance_m, duration_s")
    .eq("route_key", key)
    .maybeSingle();
  if (cached) {
    return { distance_m: cached.distance_m as number, duration_s: cached.duration_s as number };
  }

  const attempts: Array<() => Promise<RouteSummary>> = [() => osrmRoute(start, end)];

  const route = await runChain(attempts);

  await db.from("route_cache").upsert({
    route_key: key,
    distance_m: route.distance_m,
    duration_s: route.duration_s,
  });

  return route;
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!isTrustedRequest(req)) {
    return json({ error: "Requests from this origin are not allowed." }, 403);
  }

  try {
    const { start, end } = await req.json();

    if (typeof start !== "string" || typeof end !== "string" || !start.trim() || !end.trim()) {
      return json({ error: "Please enter both a start and an end address." }, 400);
    }
    if (start.length > 300 || end.length > 300) {
      return json({ error: "Addresses are too long." }, 400);
    }

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const clientIp =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-real-ip") ??
      (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    const ipHash = await hashIp(clientIp);

    const [perMinute, perHour, globalAllowed] = await Promise.all([
      consumeQuota(db, `ip-min:${ipHash}`, IP_LIMIT_PER_MINUTE, 60),
      consumeQuota(db, `ip:${ipHash}`, IP_LIMIT_PER_HOUR, 3600),
      consumeQuota(db, "global", GLOBAL_LIMIT_PER_DAY, 86400),
    ]);

    if (!perMinute) {
      return json(
        { error: "Too many calculations. Please wait a minute and try again." },
        429,
        { "Retry-After": "60" }
      );
    }
    if (!perHour || !globalAllowed) {
      return json(
        {
          error:
            "The free calculator is temporarily rate limited. Please try again later or sign in for bulk calculations.",
        },
        429,
        { "Retry-After": "3600" }
      );
    }

    const [startCoords, endCoords] = await Promise.all([
      resolveAddress(db, start),
      resolveAddress(db, end),
    ]);

    const route = await resolveRoute(db, startCoords, endCoords);

    return json({
      distance_km: route.distance_m / 1000,
      distance_mi: route.distance_m / 1609.344,
      duration_min: Math.round(route.duration_s / 60),
    });
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable) {
      return json({ error: err.message }, 400);
    }
    return json(
      { error: "Distance services are busy right now. Please try again in a moment." },
      503
    );
  }
});
