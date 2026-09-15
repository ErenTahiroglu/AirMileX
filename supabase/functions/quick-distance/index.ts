import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Public services are tried first; anything slower than this falls back to keyed providers. */
const OPEN_SERVICE_TIMEOUT_MS = 2500;
const USER_AGENT = "AirMileX/1.0 (quick mileage calculator)";

type LonLat = [number, number];

interface RouteSummary {
  distance_m: number;
  duration_s: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizeKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = OPEN_SERVICE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Matches "41.0082, 28.9784" style plain coordinate input. */
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

function parseCoordinates(text: string): LonLat | null {
  const match = COORD_RE.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

// ---------------------------------------------------------------- geocoding

async function nominatimGeocode(address: string): Promise<LonLat> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  const hit = data?.[0];
  if (!hit) throw new Error(`Address not found: ${address}`);
  return [Number(hit.lon), Number(hit.lat)];
}

async function geoapifyGeocode(apiKey: string, address: string): Promise<LonLat> {
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&limit=1&format=json&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geoapify geocoding ${res.status}`);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw new Error(`Address not found: ${address}`);
  return [hit.lon, hit.lat];
}

async function orsGeocode(apiKey: string, address: string): Promise<LonLat> {
  const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(address)}&size=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ORS geocoding ${res.status}`);
  const data = await res.json();
  const coords = data.features?.[0]?.geometry?.coordinates;
  if (!coords) throw new Error(`Address not found: ${address}`);
  return [coords[0], coords[1]];
}

// ------------------------------------------------------------------ routing

async function osrmRoute(start: LonLat, end: LonLat): Promise<RouteSummary> {
  const url = `https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${end[0]},${end[1]}?overview=false`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error("No route found");
  return { distance_m: route.distance, duration_s: route.duration };
}

async function geoapifyRoute(apiKey: string, start: LonLat, end: LonLat): Promise<RouteSummary> {
  const waypoints = `${start[1]},${start[0]}|${end[1]},${end[0]}`;
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(waypoints)}&mode=drive&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geoapify routing ${res.status}`);
  const data = await res.json();
  const props = data.features?.[0]?.properties;
  if (!props?.distance) throw new Error("No route found");
  return { distance_m: props.distance, duration_s: props.time };
}

async function orsRoute(apiKey: string, start: LonLat, end: LonLat): Promise<RouteSummary> {
  const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [start, end] }),
  });
  if (!res.ok) throw new Error(`ORS routing ${res.status}`);
  const data = await res.json();
  const summary = data.routes?.[0]?.summary;
  if (summary?.distance === undefined) throw new Error("No route found");
  return { distance_m: summary.distance, duration_s: summary.duration };
}

// ------------------------------------------------------- hybrid with cache

const GEOAPIFY_KEY = Deno.env.get("GEOAPIFY_API_KEY") ?? "";
const ORS_KEY = Deno.env.get("OPENROUTESERVICE_API_KEY") ?? "";

/** Abuse controls for this intentionally public endpoint. */
const IP_LIMIT_PER_HOUR = 20;
const GLOBAL_LIMIT_PER_DAY = 2000;
/** Daily ceiling on calls that hit the operator's paid fallback providers. */
const PAID_FALLBACK_LIMIT_PER_DAY = 300;

type Db = ReturnType<typeof createClient>;
type PaidGate = () => Promise<boolean>;

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

/** Keyed providers first (fast, SLA-backed); open services as failover when keys or budget run out. */
async function resolveAddress(db: Db, address: string, allowPaid: PaidGate): Promise<LonLat> {
  const direct = parseCoordinates(address);
  if (direct) return direct;

  const key = normalizeKey(address);
  const { data: cached } = await db
    .from("geocode_cache")
    .select("lat, lon")
    .eq("query_key", key)
    .maybeSingle();
  if (cached) return [cached.lon as number, cached.lat as number];

  let coords: LonLat | null = null;
  const failures: string[] = [];

  // Keyed (paid) providers are primary while the daily budget allows it.
  if ((GEOAPIFY_KEY || ORS_KEY) && (await allowPaid())) {
    const paidAttempts: Array<() => Promise<LonLat>> = [];
    if (GEOAPIFY_KEY) paidAttempts.push(() => geoapifyGeocode(GEOAPIFY_KEY, address));
    if (ORS_KEY) paidAttempts.push(() => orsGeocode(ORS_KEY, address));
    for (const attempt of paidAttempts) {
      try {
        coords = await attempt();
        break;
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
  }

  if (!coords) {
    try {
      coords = await nominatimGeocode(address);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }

  if (!coords) throw new Error(failures[0] ?? `Address not found: ${address}`);

  await db
    .from("geocode_cache")
    .upsert({ query_key: key, lat: coords[1], lon: coords[0], label: address });

  return coords;
}

async function resolveRoute(
  db: Db,
  start: LonLat,
  end: LonLat,
  allowPaid: PaidGate
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

  let route: RouteSummary | null = null;
  const failures: string[] = [];

  if ((GEOAPIFY_KEY || ORS_KEY) && (await allowPaid())) {
    const paidAttempts: Array<() => Promise<RouteSummary>> = [];
    if (GEOAPIFY_KEY) paidAttempts.push(() => geoapifyRoute(GEOAPIFY_KEY, start, end));
    if (ORS_KEY) paidAttempts.push(() => orsRoute(ORS_KEY, start, end));
    for (const attempt of paidAttempts) {
      try {
        route = await attempt();
        break;
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
  }

  if (!route) {
    try {
      route = await osrmRoute(start, end);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }

  if (!route) throw new Error(failures[0] ?? "No route found");

  await db.from("route_cache").upsert({
    route_key: key,
    distance_m: route.distance_m,
    duration_s: route.duration_s,
  });

  return route;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

    const ipHashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(clientIp)
    );
    const ipHash = Array.from(new Uint8Array(ipHashBuffer))
      .slice(0, 12)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const [ipAllowed, globalAllowed] = await Promise.all([
      consumeQuota(db, `ip:${ipHash}`, IP_LIMIT_PER_HOUR, 3600),
      consumeQuota(db, "global", GLOBAL_LIMIT_PER_DAY, 86400),
    ]);

    if (!ipAllowed || !globalAllowed) {
      return new Response(
        JSON.stringify({
          error:
            "The free calculator is temporarily rate limited. Please try again later or sign in for bulk calculations.",
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "3600" },
        }
      );
    }

    // Shared daily budget for the operator's paid fallback providers.
    const allowPaid: PaidGate = () =>
      consumeQuota(db, "paid-fallback", PAID_FALLBACK_LIMIT_PER_DAY, 86400);

    const [startCoords, endCoords] = await Promise.all([
      resolveAddress(db, start, allowPaid),
      resolveAddress(db, end, allowPaid),
    ]);

    const route = await resolveRoute(db, startCoords, endCoords, allowPaid);

    return json({
      distance_km: route.distance_m / 1000,
      distance_mi: route.distance_m / 1609.344,
      duration_min: Math.round(route.duration_s / 60),
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
