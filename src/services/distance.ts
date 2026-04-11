import { supabase } from "@/integrations/supabase/client";

export interface AddressPair {
  record_id: string;
  start: string;
  end: string;
}

export interface DistanceResult {
  record_id: string;
  distance_km: number;
  distance_mi: number;
  status: "ok" | "error";
  error?: string;
}

export const calculateDistances = async (
  pairs: AddressPair[]
): Promise<{ results: DistanceResult[] }> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await supabase.functions.invoke("distance-proxy", {
    body: { pairs },
  });

  if (response.error) throw new Error(response.error.message);
  return response.data;
};
