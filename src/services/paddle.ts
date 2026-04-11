import { supabase } from "@/integrations/supabase/client";

export const createCheckout = async (): Promise<{ transaction_id: string; checkout_url: string }> => {
  const { data, error } = await supabase.functions.invoke("paddle-checkout");
  if (error) throw error;
  return data;
};
