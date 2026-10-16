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
  error_type?: "not_found" | "network" | "provider" | "indeterminate";
  /** Frontend-only: AI-drafted business purpose for this row. */
  purposeText?: string;
}

export interface CalculateDistancesResponse {
  results: DistanceResult[];
  credits_remaining?: number;
  refund_error?: string;
}


export const calculateDistances = async (
  pairs: AddressPair[],
  options?: { is_bulk?: boolean }
): Promise<CalculateDistancesResponse> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await supabase.functions.invoke("distance-proxy", {
    body: { pairs, is_bulk: options?.is_bulk ?? false },
  });

  if (response.error) throw new Error(response.error.message);
  return response.data;
};

