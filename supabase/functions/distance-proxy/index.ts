import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

async function googleDistance(apiKey: string, pairs: AddressPair[]): Promise<DistanceResult[]> {
  const results: DistanceResult[] = [];
  for (const pair of pairs) {
    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(pair.start)}&destinations=${encodeURIComponent(pair.end)}&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      const element = data.rows?.[0]?.elements?.[0];
      if (element?.status === "OK") {
        const meters = element.distance.value;
        results.push({ record_id: pair.record_id, distance_km: meters / 1000, distance_mi: meters / 1609.344, status: "ok" });
      } else {
        results.push({ record_id: pair.record_id, distance_km: 0, distance_mi: 0, status: "error", error: element?.status || "Unknown error" });
      }
    } catch (err) {
      results.push({ record_id: pair.record_id, distance_km: 0, distance_mi: 0, status: "error", error: (err as Error).message });
    }
  }
  return results;
}

/** Matches "41.0082, 28.9784" style plain coordinate input. */
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

type LonLat = [number, number];

/** Returns [lon, lat] when the text is already a coordinate pair, else null. */
function parseCoordinates(text: string): LonLat | null {
  const match = COORD_RE.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

async function orsGeocode(apiKey: string, address: string): Promise<LonLat> {
  const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(address)}&size=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status}) for: ${address}`);
  const data = await res.json();
  const coords = data.features?.[0]?.geometry?.coordinates;
  if (!coords) throw new Error(`Could not geocode: ${address}`);
  return [coords[0], coords[1]];
}

async function geoapifyGeocode(apiKey: string, address: string): Promise<LonLat> {
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(address)}&limit=1&format=json&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status}) for: ${address}`);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw new Error(`Could not geocode: ${address}`);
  return [hit.lon, hit.lat];
}

/** Resolves free-text addresses to coordinates; passes through coordinate input. */
async function resolveLocation(
  provider: "openrouteservice" | "geoapify",
  apiKey: string,
  text: string
): Promise<LonLat> {
  const direct = parseCoordinates(text);
  if (direct) return direct;
  return provider === "geoapify"
    ? await geoapifyGeocode(apiKey, text)
    : await orsGeocode(apiKey, text);
}

async function orsRoute(apiKey: string, start: LonLat, end: LonLat): Promise<number> {
  const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [start, end] }),
  });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data = await res.json();
  const meters = data.routes?.[0]?.summary?.distance;
  if (meters === undefined) throw new Error("No route found");
  return meters as number;
}

async function geoapifyRoute(apiKey: string, start: LonLat, end: LonLat): Promise<number> {
  const waypoints = `${start[1]},${start[0]}|${end[1]},${end[0]}`;
  const url = `https://api.geoapify.com/v1/routing?waypoints=${encodeURIComponent(waypoints)}&mode=drive&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const data = await res.json();
  const meters = data.features?.[0]?.properties?.distance;
  if (meters === undefined) throw new Error("No route found");
  return meters as number;
}

/** Geocode-then-route flow for OpenRouteService and Geoapify. */
async function geocodeAndRoute(
  provider: "openrouteservice" | "geoapify",
  apiKey: string,
  pairs: AddressPair[]
): Promise<DistanceResult[]> {
  const results: DistanceResult[] = [];
  for (const pair of pairs) {
    try {
      const startCoords = await resolveLocation(provider, apiKey, pair.start);
      const endCoords = await resolveLocation(provider, apiKey, pair.end);
      const meters =
        provider === "geoapify"
          ? await geoapifyRoute(apiKey, startCoords, endCoords)
          : await orsRoute(apiKey, startCoords, endCoords);
      results.push({
        record_id: pair.record_id,
        distance_km: meters / 1000,
        distance_mi: meters / 1609.344,
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
  return results;
}


async function getUserIdFromAuth(req: Request): Promise<string> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) {
    throw new Error("Unauthorized");
  }
  return data.claims.sub as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const userId = await getUserIdFromAuth(req);
    const { pairs } = await req.json();

    if (!pairs?.length) {
      return new Response(JSON.stringify({ error: "Missing pairs" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch keys server-side
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: settings, error: settingsErr } = await serviceClient
      .from("user_settings")
      .select("maps_api_key, maps_provider")
      .eq("id", userId)
      .single();

    if (settingsErr || !settings?.maps_api_key) {
      throw new Error("No Maps API key configured. Please add it in Settings.");
    }

    const provider = settings.maps_provider || "google";
    const apiKey = settings.maps_api_key;

    let results: DistanceResult[];
    if (provider === "google") {
      results = await googleDistance(apiKey, pairs);
    } else if (provider === "openrouteservice" || provider === "geoapify") {
      results = await geocodeAndRoute(provider, apiKey, pairs);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = (err as Error).message;
    const status = message === "Unauthorized" ? 401 : 400;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
