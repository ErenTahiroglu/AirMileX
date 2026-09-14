import { supabase } from "@/integrations/supabase/client";

export type RateUnit = "mi" | "km";

/** IRS standard mileage rate for the second half of 2026. */
export const DEFAULT_RATE_PER_MILE = 0.76;

export interface SavedMapping {
  id: string;
  user_id: string;
  table_id: string;
  start_col_id: string;
  end_col_id: string;
  distance_col_id: string;
  cost_col_id: string | null;
  rate_per_unit: number;
  rate_unit: RateUnit;
}

export interface MappingInput {
  user_id: string;
  table_id: string;
  start_col_id: string;
  end_col_id: string;
  distance_col_id: string;
  cost_col_id?: string | null;
  rate_per_unit?: number;
  rate_unit?: RateUnit;
}

export const getMapping = async (userId: string, tableId: string): Promise<SavedMapping | null> => {
  const { data, error } = await supabase
    .from("saved_mappings")
    .select("*")
    .eq("user_id", userId)
    .eq("table_id", tableId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    cost_col_id: data.cost_col_id ?? null,
    rate_per_unit: Number(data.rate_per_unit ?? DEFAULT_RATE_PER_MILE),
    rate_unit: (data.rate_unit ?? "mi") as RateUnit,
  } as SavedMapping;
};

export const upsertMapping = async (mapping: MappingInput) => {
  const { error } = await supabase
    .from("saved_mappings")
    .upsert(mapping, { onConflict: "user_id,table_id" });

  if (error) throw error;
};

/** Reimbursement amount for a trip, based on the configured rate and unit. */
export const calculateReimbursement = (
  distanceMi: number,
  ratePerUnit: number,
  unit: RateUnit
): number => {
  const distance = unit === "km" ? distanceMi * 1.609344 : distanceMi;
  return distance * ratePerUnit;
};
