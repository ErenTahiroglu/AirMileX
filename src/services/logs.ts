import { supabase } from "@/integrations/supabase/client";

export interface CalculationLog {
  id: string;
  user_id: string;
  base_id: string;
  table_id: string;
  records_processed: number;
  provider_used: string;
  created_at: string;
}

export const insertLog = async (log: {
  user_id: string;
  base_id: string;
  table_id: string;
  records_processed: number;
  provider_used: string;
}) => {
  const { error } = await supabase.from("calculation_logs").insert(log);
  if (error) throw error;
};

export const getTotalRecords = async (userId: string): Promise<number> => {
  const { data, error } = await supabase
    .from("calculation_logs")
    .select("records_processed")
    .eq("user_id", userId);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.records_processed, 0);
};

export const getRecentLogs = async (userId: string, limit = 10): Promise<CalculationLog[]> => {
  const { data, error } = await supabase
    .from("calculation_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
};
