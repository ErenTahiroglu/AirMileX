import { supabase } from "@/integrations/supabase/client";

export interface AddressSuggestion {
  label: string;
  lat: number;
  lon: number;
}

/**
 * Server-proxied address suggestions. Provider keys stay on the server;
 * the browser only ever sees the resulting labels.
 */
export const searchAddresses = async (query: string): Promise<AddressSuggestion[]> => {
  if (query.trim().length < 3) return [];

  const { data, error } = await supabase.functions.invoke("address-autocomplete", {
    body: { query },
  });

  if (error) return [];
  return ((data as { suggestions?: AddressSuggestion[] })?.suggestions ?? []).filter(
    (s) => Boolean(s.label)
  );
};
