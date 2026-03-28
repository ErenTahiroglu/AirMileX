import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
        results.push({
          record_id: pair.record_id,
          distance_km: meters / 1000,
          distance_mi: meters / 1609.344,
          status: "ok",
        });
      } else {
        results.push({
          record_id: pair.record_id,
          distance_km: 0,
          distance_mi: 0,
          status: "error",
          error: element?.status || "Unknown error",
        });
      }
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

async function orsDistance(apiKey: string, pairs: AddressPair[]): Promise<DistanceResult[]> {
  const results: DistanceResult[] = [];

  for (const pair of pairs) {
    try {
      // First geocode start and end
      const geocode = async (addr: string) => {
        const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(addr)}&size=1`;
        const res = await fetch(url);
        const data = await res.json();
        const coords = data.features?.[0]?.geometry?.coordinates;
        if (!coords) throw new Error(`Could not geocode: ${addr}`);
        return coords as [number, number]; // [lng, lat]
      };

      const startCoords = await geocode(pair.start);
      const endCoords = await geocode(pair.end);

      const dirRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [startCoords, endCoords],
        }),
      });

      const dirData = await dirRes.json();
      const meters = dirData.routes?.[0]?.summary?.distance;

      if (meters !== undefined) {
        results.push({
          record_id: pair.record_id,
          distance_km: meters / 1000,
          distance_mi: meters / 1609.344,
          status: "ok",
        });
      } else {
        results.push({
          record_id: pair.record_id,
          distance_km: 0,
          distance_mi: 0,
          status: "error",
          error: "No route found",
        });
      }
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { provider, api_key, pairs } = await req.json();

    if (!api_key || !pairs?.length) {
      return new Response(JSON.stringify({ error: "Missing api_key or pairs" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let results: DistanceResult[];

    if (provider === "google") {
      results = await googleDistance(api_key, pairs);
    } else if (provider === "openrouteservice") {
      results = await orsDistance(api_key, pairs);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
