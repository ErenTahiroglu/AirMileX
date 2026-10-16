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

export interface PaginatedRecordsResult {
  records: Array<{ id: string; fields: Record<string, unknown> }>;
  total: number;
  limitReached: boolean;
  exhausted: boolean;
  pageCount: number;
  offset?: string;
}

export const readEligibleRecords = (
  baseId: string,
  tableId: string,
  distanceFieldId: string,
  maxRecords = 500
): Promise<PaginatedRecordsResult> =>
  callProxy("read-all-records", { baseId, tableId, distanceFieldId, maxRecords });

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

export interface SyncProgress {
  processed: number;
  confirmed: number;
  failed: number;
  indeterminate: number;
  total: number;
}

const isNetworkOrTimeout = (msg: string) =>
  /network|fetch|timeout|abort|502|503|504|load failed|connection/i.test(msg);

/** Airtable allows 5 records per write; batches are spaced out to avoid 429s. */
const AIRTABLE_BATCH_SIZE = 5;
const AIRTABLE_BATCH_DELAY_MS = 250;

/**
 * Writes records back to Airtable in rate-limited batches of 5, pausing 250ms
 * between batches. A failed batch does not stop later ones. Never touches credits.
 */
export const syncRecords = async (
  payload: SyncPayload,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResult> => {
  const { records, ...target } = payload;
  let processed = 0;
  let confirmed = 0;
  let failed = 0;
  let indeterminate = 0;

  const attempts = await runBatched<SyncRecord, BatchAttempt>(
    records,
    async (batch) => {
      const ids = batch.map((r) => r.id);
      try {
        const result = (await callProxy("sync-records", { ...target, records: batch })) as Partial<SyncResult>;
        const succCount = result.succeededIds?.length ?? 0;
        const indetCount = result.indeterminateIds?.length ?? 0;
        confirmed += succCount;
        indeterminate += indetCount;
        failed += ids.length - succCount - indetCount;
        processed += ids.length;
        onProgress?.({ processed, confirmed, failed, indeterminate, total: records.length });
        return { ids, result };
      } catch (e) {
        const errorMsg = (e as Error).message || "Unknown error";
        const isIndet = isNetworkOrTimeout(errorMsg);
        if (isIndet) {
          indeterminate += ids.length;
        } else {
          failed += ids.length;
        }
        processed += ids.length;
        onProgress?.({ processed, confirmed, failed, indeterminate, total: records.length });
        return { ids, error: errorMsg, indeterminate: isIndet };
      }
    },
    { batchSize: AIRTABLE_BATCH_SIZE, delayMs: AIRTABLE_BATCH_DELAY_MS }
  );

  return aggregateSync(attempts);
};
