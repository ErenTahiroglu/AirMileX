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

async function orsDistance(apiKey: string, pairs: AddressPair[]): Promise<DistanceResult[]> {
  const results: DistanceResult[] = [];
  for (const pair of pairs) {
    try {
      const geocode = async (addr: string) => {
        const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(addr)}&size=1`;
        const res = await fetch(url);
        const data = await res.json();
        const coords = data.features?.[0]?.geometry?.coordinates;
        if (!coords) throw new Error(`Could not geocode: ${addr}`);
        return coords as [number, number];
      };
      const startCoords = await geocode(pair.start);
      const endCoords = await geocode(pair.end);
      const dirRes = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [startCoords, endCoords] }),
      });
      const dirData = await dirRes.json();
      const meters = dirData.routes?.[0]?.summary?.distance;
      if (meters !== undefined) {
        results.push({ record_id: pair.record_id, distance_km: meters / 1000, distance_mi: meters / 1609.344, status: "ok" });
      } else {
        results.push({ record_id: pair.record_id, distance_km: 0, distance_mi: 0, status: "error", error: "No route found" });
      }
    } catch (err) {
      results.push({ record_id: pair.record_id, distance_km: 0, distance_mi: 0, status: "error", error: (err as Error).message });
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
    } else if (provider === "openrouteservice") {
      results = await orsDistance(apiKey, pairs);
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
