/** Aggregates per-request Airtable sync results into one confirmed outcome. */

export interface SyncResult {
  synced: number;
  failed: number;
  indeterminate?: number;
  errors: string[];
  succeededIds: string[];
  failedIds: string[];
  indeterminateIds?: string[];
}

export type SyncOutcomeKind = "success" | "partial" | "failure" | "indeterminate";

/** One proxy call: either the server's result or the error that stopped it. */
export type BatchAttempt =
  | { ids: string[]; result: Partial<SyncResult> }
  | { ids: string[]; error: string; indeterminate?: boolean };

/**
 * Only IDs the server confirmed count as synced. A failed request marks its
 * whole batch failed or indeterminate; IDs the server neither confirmed nor rejected are failed too.
 */
export const aggregateSync = (attempts: BatchAttempt[]): SyncResult => {
  const succeeded = new Set<string>();
  const failed = new Set<string>();
  const indeterminate = new Set<string>();
  const errors: string[] = [];

  for (const a of attempts) {
    if ("error" in a) {
      errors.push(a.error);
      if (a.indeterminate) {
        a.ids.forEach((id) => indeterminate.add(id));
      } else {
        a.ids.forEach((id) => failed.add(id));
      }
      continue;
    }
    const ok = new Set(a.result.succeededIds ?? []);
    const indet = new Set(a.result.indeterminateIds ?? []);
    for (const id of a.ids) {
      if (ok.has(id)) {
        succeeded.add(id);
      } else if (indet.has(id)) {
        indeterminate.add(id);
      } else {
        failed.add(id);
      }
    }
    errors.push(...(a.result.errors ?? []));
  }
  return {
    synced: succeeded.size,
    failed: failed.size,
    indeterminate: indeterminate.size,
    errors,
    succeededIds: [...succeeded],
    failedIds: [...failed],
    indeterminateIds: [...indeterminate],
  };
};

export const syncOutcomeKind = (r: SyncResult): SyncOutcomeKind => {
  const indetCount = r.indeterminate ?? 0;
  if (r.synced > 0 && r.failed === 0 && indetCount === 0) return "success";
  if (r.synced === 0 && indetCount > 0 && r.failed === 0) return "indeterminate";
  if (r.synced === 0) return "failure";
  return "partial";
};
