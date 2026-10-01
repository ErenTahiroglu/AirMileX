import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

export interface CleanAddress {
  address: string;
  confidence: "high" | "medium" | "low";
  note: string;
}

export interface CleanupResult {
  start: CleanAddress;
  end: CleanAddress;
}

/** Turns rough start/end notes into geocoding-ready addresses via the AI proxy. */
export const cleanupAddresses = async (start: string, end: string): Promise<CleanupResult> => {
  const { data, error } = await supabase.functions.invoke("address-cleanup", { body: { start, end } });
  if (error) {
    let message = "Could not clean up these notes.";
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  return data as CleanupResult;
};
