import { supabase } from "@/integrations/supabase/client";
import { runBatched } from "@/lib/rateLimiter";
import { aggregateSync, type BatchAttempt, type SyncResult } from "@/lib/syncOutcome";


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

/**
 * Semantic sync record. The server maps these keys to the caller's saved
 * column mapping for the table; arbitrary field names are never accepted.
 */
export interface SyncRecord {
  id: string;
  distance?: string;
  cost?: number;
  status?: string;
  purpose?: string;
}

export interface SyncPayload {
  baseId: string;
  tableId: string;
  records: SyncRecord[];
}

export type { SyncResult } from "@/lib/syncOutcome";

/** Airtable allows 5 records per write; batches are spaced out to avoid 429s. */
const AIRTABLE_BATCH_SIZE = 5;
const AIRTABLE_BATCH_DELAY_MS = 250;

/**
 * Writes records back to Airtable in rate-limited batches of 5, pausing 250ms
 * between batches. A failed batch does not stop later ones. Never touches credits.
 */
export const syncRecords = async (
  payload: SyncPayload,
  onProgress?: (processed: number, total: number) => void
): Promise<SyncResult> => {
  const { records, ...target } = payload;

  const attempts = await runBatched<SyncRecord, BatchAttempt>(
    records,
    async (batch) => {
      const ids = batch.map((r) => r.id);
      try {
        const result = (await callProxy("sync-records", { ...target, records: batch })) as Partial<SyncResult>;
        return { ids, result };
      } catch (e) {
        return { ids, error: (e as Error).message };
      }
    },
    { batchSize: AIRTABLE_BATCH_SIZE, delayMs: AIRTABLE_BATCH_DELAY_MS, onProgress }
  );

  return aggregateSync(attempts);
};
