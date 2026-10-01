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

export interface SyncRecord {
  id: string;
  /** Field name -> value map; allows writing distance and cost in one request. */
  fields: Record<string, string | number>;
}

export interface SyncPayload {
  baseId: string;
  tableId: string;
  distanceFieldId: string;
  records: SyncRecord[];
}

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
}

/** Airtable allows 5 records per write; batches are spaced out to avoid 429s. */
const AIRTABLE_BATCH_SIZE = 5;
const AIRTABLE_BATCH_DELAY_MS = 250;

/**
 * Writes records back to Airtable in rate-limited batches of 5,
 * pausing 250ms between batches. Does not touch credits.
 */
export const syncRecords = async (
  payload: SyncPayload,
  onProgress?: (synced: number, total: number) => void
): Promise<SyncResult> => {
  const { records, ...target } = payload;

  const batchResults = (await runBatched(
    records,
    (batch) => callProxy("sync-records", { ...target, records: batch }),
    {
      batchSize: AIRTABLE_BATCH_SIZE,
      delayMs: AIRTABLE_BATCH_DELAY_MS,
      onProgress,
    }
  )) as Array<Partial<SyncResult> | undefined>;

  return batchResults.reduce<SyncResult>(
    (acc, r) => ({
      synced: acc.synced + (r?.synced ?? 0),
      failed: acc.failed + (r?.failed ?? 0),
      errors: [...acc.errors, ...(r?.errors ?? [])],
    }),
    { synced: 0, failed: 0, errors: [] }
  );
};

