import { supabase } from "@/integrations/supabase/client";

export interface SavedMapping {
  id: string;
  user_id: string;
  table_id: string;
  start_col_id: string;
  end_col_id: string;
  distance_col_id: string;
}

export const getMapping = async (userId: string, tableId: string): Promise<SavedMapping | null> => {
  const { data, error } = await supabase
    .from("saved_mappings")
    .select("*")
    .eq("user_id", userId)
    .eq("table_id", tableId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const upsertMapping = async (mapping: {
  user_id: string;
  table_id: string;
  start_col_id: string;
  end_col_id: string;
  distance_col_id: string;
}) => {
  const { error } = await supabase
    .from("saved_mappings")
    .upsert(mapping, { onConflict: "user_id,table_id" });

  if (error) throw error;
};
