import { buildSyncRecords } from "@/lib/jobSync";
import type { DistanceResult } from "@/services/distance";
import { upsertMapping, type RateUnit } from "@/services/mappings";
import { syncRecords, type SyncResult, type SyncProgress } from "@/services/airtable";
import { insertLog } from "@/services/logs";

export interface ExecuteJobSyncParams {
  user: { id: string } | null;
  selectedBase: string;
  selectedTable: string;
  startCol: string;
  endCol: string;
  distanceCol: string;
  costCol: string;
  statusCol: string;
  notesCol: string;
  purposeCol: string;
  ratePerUnit: number;
  rateUnit: RateUnit;
  distances: DistanceResult[];
  purposes: Record<string, string>;
  confirmedSyncIds: string[];
  failedSyncIds: string[];
  syncedCount: number | null;
  provider: string;
  calculating: boolean;
  syncing: boolean;
  generatingPurposes?: boolean;
  confirmWithoutPurposes?: boolean;
  upsertMappingFn?: typeof upsertMapping;
  syncRecordsFn?: typeof syncRecords;
  insertLogFn?: typeof insertLog;
  setSyncing: (syncing: boolean) => void;
  setMappingStatus: (status: "idle" | "loading" | "saving" | "saved" | "error") => void;
  setMappingError: (err: string | null) => void;
  setSyncProgress: (progress: SyncProgress) => void;
  setConfirmedSyncIds: (ids: string[]) => void;
  setFailedSyncIds: (ids: string[]) => void;
  setSyncedCount: (count: number) => void;
  setShowSummary: (show: boolean) => void;
  toast: (props: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
}

export async function executeJobSync(params: ExecuteJobSyncParams): Promise<void> {
  const {
    user,
    selectedBase,
    selectedTable,
    startCol,
    endCol,
    distanceCol,
    costCol,
    statusCol,
    notesCol,
    purposeCol,
    ratePerUnit,
    rateUnit,
    distances,
    purposes,
    confirmedSyncIds,
    failedSyncIds,
    provider,
    calculating,
    syncing,
    generatingPurposes = false,
    confirmWithoutPurposes = false,
    upsertMappingFn = upsertMapping,
    syncRecordsFn = syncRecords,
    insertLogFn = insertLog,
    setSyncing,
    setMappingStatus,
    setMappingError,
    setSyncProgress,
    setConfirmedSyncIds,
    setFailedSyncIds,
    setSyncedCount,
    setShowSummary,
    toast,
  } = params;

  if (!distances.length || !selectedTable || !user) return;
  if (calculating || syncing) return;

  // 1. Guard against premature sync while automatic AI purpose generation is running
  if (generatingPurposes && Boolean(purposeCol || notesCol) && !confirmWithoutPurposes) {
    toast({
      title: "AI purposes generating",
      description: "Please wait for AI business purposes to finish generating before syncing.",
      variant: "destructive",
    });
    return;
  }

  if (!startCol || !endCol || !distanceCol) {
    toast({
      title: "Mapping required",
      description: "Please map Start, End, and Distance columns.",
      variant: "destructive",
    });
    return;
  }

  // 2. Build sync records; exclude already confirmed records to prevent duplicate sync
  const withPurpose = distances.map((d) => ({ ...d, purposeText: purposes[d.record_id] }));
  const allSyncRecords = buildSyncRecords(
    withPurpose,
    { cost: Boolean(costCol), status: Boolean(statusCol), purpose: Boolean(purposeCol) },
    ratePerUnit,
    rateUnit,
  );

  const pendingRecords = allSyncRecords.filter((r) => !confirmedSyncIds.includes(r.id));

  if (allSyncRecords.length > 0 && pendingRecords.length === 0) {
    toast({
      title: "All records synced",
      description: "All records for this job have already been confirmed in Airtable.",
    });
    return;
  }

  const recordsToSync = failedSyncIds.length > 0
    ? pendingRecords.filter((r) => failedSyncIds.includes(r.id))
    : pendingRecords;

  if (recordsToSync.length === 0) {
    toast({
      title: "No records to sync",
      description: "No pending or failed records remain to be synced.",
    });
    return;
  }

  setSyncing(true);

  // 3. Await and confirm mapping persistence before initiating Airtable sync
  try {
    setMappingStatus("saving");
    setMappingError(null);
    await upsertMappingFn({
      user_id: user.id,
      table_id: selectedTable,
      start_col_id: startCol,
      end_col_id: endCol,
      distance_col_id: distanceCol,
      cost_col_id: costCol || null,
      status_col_id: statusCol || null,
      notes_col_id: notesCol || null,
      purpose_col_id: purposeCol || null,
      rate_per_unit: ratePerUnit,
      rate_unit: rateUnit,
    });
    setMappingStatus("saved");
  } catch (err) {
    const msg = (err as Error).message || "Failed to persist column mapping";
    setMappingStatus("error");
    setMappingError(msg);
    setSyncing(false);
    toast({
      title: "Cannot sync to Airtable",
      description: `Column mapping must be saved before syncing: ${msg}`,
      variant: "destructive",
    });
    return;
  }

  setSyncProgress({ processed: 0, confirmed: 0, failed: 0, indeterminate: 0, total: recordsToSync.length });

  try {
    const result: SyncResult = await syncRecordsFn(
      {
        baseId: selectedBase,
        tableId: selectedTable,
        records: recordsToSync,
      },
      (progress) => setSyncProgress(progress)
    );

    // Track confirmed IDs and failed/indeterminate IDs for safe retry
    const nextConfirmedIds = Array.from(new Set([...confirmedSyncIds, ...result.succeededIds]));
    setConfirmedSyncIds(nextConfirmedIds);

    const indetCount = result.indeterminate ?? 0;
    const retryableIds = Array.from(new Set([
      ...result.failedIds,
      ...(result.indeterminateIds ?? []),
    ]));
    setFailedSyncIds(retryableIds);

    // Cumulative confirmed writes across all attempts for this job
    setSyncedCount(nextConfirmedIds.length);
    setShowSummary(true);

    // 4. Audit log reflects actual newly confirmed writes only; log failure must not report sync failure
    if (result.synced > 0) {
      try {
        await insertLogFn({
          user_id: user.id,
          base_id: selectedBase,
          table_id: selectedTable,
          records_processed: result.synced,
          provider_used: provider,
        });
      } catch (logErr) {
        console.error("Audit log error:", logErr);
        toast({
          title: "Audit log notice",
          description: "Records were updated in Airtable, but the local audit log could not be saved.",
        });
      }
    }

    // 5. Distinguish full success, partial success, complete failure, and indeterminate network outcomes
    if (result.synced > 0 && result.failed === 0 && indetCount === 0) {
      toast({
        title: "Sync complete",
        description: `All ${result.synced} records updated successfully.`,
      });
    } else if (result.synced === 0 && indetCount > 0 && result.failed === 0) {
      toast({
        title: "Sync outcome indeterminate",
        description: `Network error occurred. ${indetCount} record(s) could not be confirmed in Airtable. You can retry.`,
        variant: "destructive",
      });
    } else if (result.synced === 0 && result.failed > 0 && indetCount === 0) {
      toast({
        title: "Sync failed",
        description: `All ${result.failed} records failed to sync. ${result.errors[0] || ""}`,
        variant: "destructive",
      });
    } else {
      const parts = [
        result.synced > 0 ? `${result.synced} records updated` : null,
        result.failed > 0 ? `${result.failed} records failed` : null,
        indetCount > 0 ? `${indetCount} unconfirmed due to network error` : null,
      ].filter(Boolean).join(", ");

      toast({
        title: "Partial sync",
        description: `${parts}. You can retry unconfirmed records.`,
        variant: "destructive",
      });
    }
  } catch (e: unknown) {
    toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
  } finally {
    setSyncing(false);
  }
}
