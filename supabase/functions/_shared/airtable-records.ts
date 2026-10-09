/**
 * Pure helpers for Airtable record retrieval and batched writes.
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
