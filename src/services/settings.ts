import { supabase } from "@/integrations/supabase/client";

export interface UserSettings {
  id: string;
  airtable_pat: string | null;
  maps_api_key: string | null;
  maps_provider: string | null;
}

export const getSettings = async (userId: string): Promise<UserSettings | null> => {
  const { data, error } = await supabase
    .from("user_settings")
    .select("id, airtable_pat, maps_api_key, maps_provider")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const upsertSettings = async (settings: {
  id: string;
  airtable_pat?: string | null;
  maps_api_key?: string | null;
  maps_provider?: string | null;
}) => {
  const { error } = await supabase
    .from("user_settings")
    .upsert(settings, { onConflict: "id" });

  if (error) throw error;
};
