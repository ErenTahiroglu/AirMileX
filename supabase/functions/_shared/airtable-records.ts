/**
 * Pure helpers for Airtable record retrieval, pagination and batched writes.
 * No Deno or network APIs so they can be unit-tested with vitest.
 */

export class AirtableInputError extends Error {}

export interface TableField {
  id: string;
  name: string;
}

// Airtable formula field references `{Name}` cannot escape braces; control chars are unsafe.
// deno-lint-ignore no-control-regex
const UNSUPPORTED_NAME = /[{}\u0000-\u001f\u007f]/;

/**
 * Builds a "distance is blank" formula from the verified field name.
 * Rejects unknown field IDs and names that cannot be referenced safely.
 */
export function buildBlankFieldFormula(fieldId: unknown, fields: TableField[]): string {
  if (typeof fieldId !== "string" || !fieldId) throw new AirtableInputError("Missing distance field.");
  const field = fields.find((f) => f.id === fieldId);
  if (!field) throw new AirtableInputError("Distance field is not part of this table.");
  const name = field.name;
  if (!name.trim() || UNSUPPORTED_NAME.test(name)) {
    throw new AirtableInputError(
      `Column name "${name}" contains characters that cannot be used in a filter. Rename it in Airtable.`,
    );
  }
  return `{${name}}=BLANK()`;
}

/** Keeps the preview capped at 5 records until full pagination exists. */
export const PREVIEW_MAX = 5;
export function clampPreviewLimit(limit: unknown): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : PREVIEW_MAX;
  return Math.min(Math.max(n, 1), PREVIEW_MAX);
}

export type PatchRecord = { id: string; fields: Record<string, string | number> };

export interface BatchSyncResult {
  synced: number;
  failed: number;
  errors: string[];
  succeededIds: string[];
  failedIds: string[];
}

export class PatchError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface SyncOptions {
  batchSize?: number;
  delayMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Writes records in batches. A record counts as synced only when Airtable
 * returns its ID in the PATCH response; everything else is reported as failed.
 */
export async function syncWithBatching(
  records: PatchRecord[],
  patchBatch: (batch: PatchRecord[]) => Promise<string[]>,
  opts: SyncOptions = {},
): Promise<BatchSyncResult> {
  const { batchSize = 10, delayMs = 250, maxRetries = 3 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const succeeded = new Set<string>();
  const failedIds: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    for (let attempt = 0; ; attempt++) {
      try {
        const returned = new Set(await patchBatch(batch));
        for (const r of batch) {
          if (returned.has(r.id)) succeeded.add(r.id);
          else failedIds.push(r.id);
        }
        const missing = batch.filter((r) => !returned.has(r.id)).length;
        if (missing) errors.push(`Batch at index ${i}: Airtable did not confirm ${missing} record(s).`);
        break;
      } catch (err) {
        const status = err instanceof PatchError ? err.status : 0;
        if (status === 429 && attempt < maxRetries - 1) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        failedIds.push(...batch.map((r) => r.id));
        errors.push(`Batch at index ${i}: ${(err as Error).message}`);
        break;
      }
    }
    if (i + batchSize < records.length) await sleep(delayMs);
  }

  return {
    synced: succeeded.size,
    failed: failedIds.length,
    errors,
    succeededIds: [...succeeded],
    failedIds,
  };
}

// -------------------------------------------------------------
// Phase 2A: Airtable Offset Pagination & Field Projection
// -------------------------------------------------------------

export interface AirtableRecordItem {
  id: string;
  fields: Record<string, unknown>;
}

export class AirtablePaginationError extends Error {
  public headers?: Record<string, string> | Headers;

  constructor(
    message: string,
    public status?: number,
    public isQuotaExceeded: boolean = false,
    public isInvalidOffset: boolean = false,
  ) {
    super(message);
    this.name = "AirtablePaginationError";
  }
}

export function isQuotaLimitError(status?: number, message?: string): boolean {
  if (status === 402) return true;
  if (!message) return false;
  return /MONTHLY_APPROVED_USAGE_LIMIT_EXCEEDED|USAGE_LIMIT_EXCEEDED|PAYMENT_REQUIRED|exceeded your monthly/i.test(message);
}

export function isInvalidOffsetError(status?: number, message?: string): boolean {
  if (status === 422) return true;
  if (!message) return false;
  return /INVALID_OFFSET|LIST_RECORDS_ITERATOR_NOT_AVAILABLE|invalid offset|offset has expired/i.test(message);
}

export interface PaginatedRecordsResult {
  records: AirtableRecordItem[];
  total: number;
  limitReached: boolean;
  exhausted: boolean;
  pageCount: number;
  offset?: string;
}

export interface ReadPaginatedOptions {
  maxRecords?: number;
  pageSize?: number;
  delayMs?: number;
  maxRetries?: number;
  defaultCooldownMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Projects raw Airtable records to only include fields that are in the allowed
 * mapped field names set. Strips unmapped and potentially sensitive columns.
 */
export function projectMappedFields(
  records: AirtableRecordItem[],
  allowedFieldNames: Set<string>
): AirtableRecordItem[] {
  return records.map((record) => {
    const projectedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record.fields ?? {})) {
      if (allowedFieldNames.has(key)) {
        projectedFields[key] = value;
      }
    }
    return {
      id: record.id,
      fields: projectedFields,
    };
  });
}

/**
 * Iterates through Airtable pages using the official offset pagination contract.
 * - Stops when either the limit (up to 500) is reached or the record set is exhausted (no offset returned).
 * - Distinguishes limitReached from exhausted.
 * - Respects Retry-After header on 429, defaulting to a 30-second cooldown.
 * - Refuses to retry permanent monthly usage/quota errors.
 * - Never silently returns partial data on failure.
 */
export async function paginateAirtableRecords(
  fetchPage: (offset?: string) => Promise<{
    records?: AirtableRecordItem[];
    offset?: string;
    status?: number;
    error?: any;
    headers?: Record<string, string> | Headers;
  }>,
  opts: ReadPaginatedOptions = {}
): Promise<PaginatedRecordsResult> {
  const maxRecords = Math.min(Math.max(opts.maxRecords ?? 500, 1), 500);
  const delayMs = opts.delayMs ?? 200;
  const maxRetries = opts.maxRetries ?? 1;
  const defaultCooldownMs = opts.defaultCooldownMs ?? 30000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const allRecords: AirtableRecordItem[] = [];
  let currentOffset: string | undefined = undefined;
  let pageCount = 0;
  let limitReached = false;
  let exhausted = false;
  let nextOffset: string | undefined = undefined;

  while (allRecords.length < maxRecords) {
    let pageRes: {
      records?: AirtableRecordItem[];
      offset?: string;
      status?: number;
      error?: any;
      headers?: Record<string, string> | Headers;
    } | undefined = undefined;

    for (let attempt = 0; ; attempt++) {
      try {
        pageRes = await fetchPage(currentOffset);
        break;
      } catch (err: any) {
        const status = err?.status ?? (err instanceof AirtablePaginationError ? err.status : undefined);
        const msg = String(err?.message ?? "");

        // 1. Quota limit check: do not retry permanent quota exhaustion
        if (err?.isQuotaExceeded || isQuotaLimitError(status, msg)) {
          throw err instanceof AirtablePaginationError
            ? err
            : new AirtablePaginationError(msg, status, true, false);
        }

        // 2. Invalid/expired offset check
        if (err?.isInvalidOffset || isInvalidOffsetError(status, msg)) {
          throw err instanceof AirtablePaginationError
            ? err
            : new AirtablePaginationError(msg, status, false, true);
        }

        // 3. HTTP 429 rate limit handling
        if (status === 429 && attempt < maxRetries) {
          let cooldown = defaultCooldownMs;
          const headers = err?.headers;
          let retryHeaderVal: string | null = null;
          if (headers) {
            if (typeof (headers as Headers).get === "function") {
              retryHeaderVal = (headers as Headers).get("retry-after");
            } else if (typeof headers === "object") {
              retryHeaderVal =
                (headers as Record<string, string>)["retry-after"] ??
                (headers as Record<string, string>)["Retry-After"] ??
                null;
            }
          }
          if (retryHeaderVal) {
            const parsedSeconds = parseFloat(retryHeaderVal);
            if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
              cooldown = Math.ceil(parsedSeconds * 1000);
            }
          }
          await sleep(cooldown);
          continue;
        }

        // Non-retryable or retries exhausted
        throw err;
      }
    }

    if (!pageRes || !Array.isArray(pageRes.records)) {
      throw new AirtablePaginationError("Invalid page response from Airtable: missing records array", 502);
    }

    pageCount++;
    const pageRecords = pageRes.records;
    const remainingSlots = maxRecords - allRecords.length;

    if (pageRecords.length <= remainingSlots) {
      allRecords.push(...pageRecords);
      currentOffset = pageRes.offset;
      if (!currentOffset) {
        exhausted = true;
        limitReached = false;
        nextOffset = undefined;
        break;
      } else if (allRecords.length === maxRecords) {
        limitReached = true;
        exhausted = false;
        nextOffset = currentOffset;
        break;
      }
    } else {
      allRecords.push(...pageRecords.slice(0, remainingSlots));
      limitReached = true;
      exhausted = false;
      nextOffset = pageRes.offset ?? currentOffset;
      break;
    }

    if (currentOffset && allRecords.length < maxRecords) {
      await sleep(delayMs);
    }
  }

  return {
    records: allRecords,
    total: allRecords.length,
    limitReached,
    exhausted,
    pageCount,
    offset: nextOffset,
  };
}
