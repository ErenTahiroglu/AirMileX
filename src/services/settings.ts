import { supabase } from "@/integrations/supabase/client";

export interface UserSettings {
  id: string;
  maps_provider: string | null;
  credits: number;
  has_pat: boolean;
  has_maps_key: boolean;
}

export const getSettings = async (userId: string): Promise<UserSettings | null> => {
  const { data, error } = await supabase.rpc("get_settings_flags", {
    p_user_id: userId,
  });

  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0];
  return {
    id: row.id,
    maps_provider: row.maps_provider,
    credits: row.credits,
    has_pat: row.has_pat,
    has_maps_key: row.has_maps_key,
  };
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
