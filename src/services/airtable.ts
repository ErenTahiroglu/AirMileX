import { supabase } from "@/integrations/supabase/client";
import { runBatched } from "@/lib/rateLimiter";


const callProxy = async (action: string, payload: Record<string, unknown> | object) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await supabase.functions.invoke("airtable-proxy", {
    body: { action, ...payload },
  });

  if (response.error) throw new Error(response.error.message);
  return response.data;
};

export const testConnection = () =>
  callProxy("whoami", {});

export const listBases = () =>
  callProxy("list-bases", {});

export const listTables = (baseId: string) =>
  callProxy("list-tables", { baseId });

export const readRecords = (
  baseId: string,
  tableId: string,
  distanceFieldId: string,
  limit = 5
) =>
  callProxy("read-records", { baseId, tableId, distanceFieldId, limit });

export interface SyncPayload {
  baseId: string;
  tableId: string;
  distanceFieldId: string;
  records: { id: string; value: string }[];
}

export interface SyncResult {
  synced: number;
  credits_remaining?: number;
}

/** Airtable allows 5 records per write; batches are spaced out to avoid 429s. */
const AIRTABLE_BATCH_SIZE = 5;
const AIRTABLE_BATCH_DELAY_MS = 250;

/**
 * Writes records back to Airtable in rate-limited batches of 5,
 * pausing 250ms between batches.
 */
export const syncRecords = async (
  payload: SyncPayload,
  onProgress?: (synced: number, total: number) => void
): Promise<SyncResult> => {
  const { records, ...target } = payload;

  const batchResults = await runBatched(
    records,
    (batch) => callProxy("sync-records", { ...target, records: batch }),
    {
      batchSize: AIRTABLE_BATCH_SIZE,
      delayMs: AIRTABLE_BATCH_DELAY_MS,
      onProgress,
    }
  );

  const synced = batchResults.reduce(
    (total: number, result: SyncResult | undefined) => total + (result?.synced ?? 0),
    0
  );

  const last = batchResults[batchResults.length - 1] as SyncResult | undefined;

  return { synced, credits_remaining: last?.credits_remaining };
};

