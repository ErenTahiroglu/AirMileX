import { supabase } from "@/integrations/supabase/client";

export interface QuickDistanceResult {
  distance_km: number;
  distance_mi: number;
  duration_min: number;
}

/**
 * Distance lookup for signed-in users (sign-in required server-side).
 * Backed by open map services with keyed providers as failover.
 */
export const quickDistance = async (
  start: string,
  end: string
): Promise<QuickDistanceResult> => {
  const { data, error } = await supabase.functions.invoke("quick-distance", {
    body: { start, end },
  });

  if (error) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message || "We couldn't calculate that route. Try a more specific address.");
  }
  if ((data as { error?: string })?.error) {
    throw new Error((data as { error: string }).error);
  }

  return data as QuickDistanceResult;
};
