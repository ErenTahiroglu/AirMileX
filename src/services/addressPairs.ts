import { supabase } from "@/integrations/supabase/client";

export interface SavedAddressPair {
  id: string;
  label: string;
  start_address: string;
  end_address: string;
  created_at: string;
}

export const listAddressPairs = async (): Promise<SavedAddressPair[]> => {
  const { data, error } = await supabase
    .from("saved_address_pairs")
    .select("id,label,start_address,end_address,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const createAddressPair = async (
  userId: string,
  input: { label: string; start_address: string; end_address: string },
): Promise<void> => {
  const { error } = await supabase.from("saved_address_pairs").insert({ user_id: userId, ...input });
  if (error) throw error;
};

export const deleteAddressPair = async (id: string): Promise<void> => {
  const { error } = await supabase.from("saved_address_pairs").delete().eq("id", id);
  if (error) throw error;
};
