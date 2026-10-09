/** Aggregates per-request Airtable sync results into one confirmed outcome. */

export interface SyncResult {
  synced: number;
  failed: number;
  errors: string[];
  succeededIds: string[];
  failedIds: string[];
}

export type SyncOutcomeKind = "success" | "partial" | "failure";

/** One proxy call: either the server's result or the error that stopped it. */
export type BatchAttempt =
  | { ids: string[]; result: Partial<SyncResult> }
  | { ids: string[]; error: string };

/**
 * Only IDs the server confirmed count as synced. A failed request marks its
 * whole batch failed; IDs the server neither confirmed nor rejected are failed too.
 */
export const aggregateSync = (attempts: BatchAttempt[]): SyncResult => {
  const succeeded = new Set<string>();
  const failed = new Set<string>();
  const errors: string[] = [];
  for (const a of attempts) {
    if ("error" in a) {
      a.ids.forEach((id) => failed.add(id));
      errors.push(a.error);
      continue;
    }
    const ok = new Set(a.result.succeededIds ?? []);
    for (const id of a.ids) (ok.has(id) ? succeeded : failed).add(id);
    errors.push(...(a.result.errors ?? []));
  }
  return {
    synced: succeeded.size,
    failed: failed.size,
    errors,
    succeededIds: [...succeeded],
    failedIds: [...failed],
  };
};

export const syncOutcomeKind = (r: SyncResult): SyncOutcomeKind =>
  r.failed === 0 && r.synced > 0 ? "success" : r.synced === 0 ? "failure" : "partial";
