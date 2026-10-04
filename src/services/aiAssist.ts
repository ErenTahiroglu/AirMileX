import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

export interface VerifiedAddress {
  address: string;
  lat: number;
  lon: number;
}

export interface AddressFixResult {
  start: VerifiedAddress[];
  end: VerifiedAddress[];
}

/** Error that keeps the HTTP status so callers can react to 402 (no credits). */
export class AiAssistError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const invoke = async <T>(fn: string, body: unknown, fallback: string): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let message = fallback;
    let status = 500;
    if (error instanceof FunctionsHttpError) {
      status = error.context.status;
      const payload = await error.context.json().catch(() => null);
      if (payload?.error) message = payload.error;
    }
    throw new AiAssistError(message, status);
  }
  return data as T;
};

/** Asks AI for corrected variants of a failed pair; only map-verified addresses come back. */
export const suggestAddressFix = (start: string, end: string) =>
  invoke<AddressFixResult>("address-cleanup", { mode: "fix", start, end }, "Could not suggest corrections.");

/** Drafts IRS-style business purposes; result is aligned with the input notes (null = failed). */
export const generatePurposes = async (notes: string[]): Promise<(string | null)[]> => {
  const data = await invoke<{ purposes: (string | null)[] }>(
    "generate-purpose",
    { notes },
    "Could not draft business purposes.",
  );
  return data.purposes;
};
