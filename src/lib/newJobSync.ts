import { buildSyncRecords } from "@/lib/jobSync";
import type { DistanceResult } from "@/services/distance";
import { upsertMapping, type RateUnit } from "@/services/mappings";
import { syncRecords, type SyncResult } from "@/services/airtable";
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
  failedSyncIds: string[];
  syncedCount: number | null;
  provider: string;
  calculating: boolean;
  syncing: boolean;
  upsertMappingFn?: typeof upsertMapping;
  syncRecordsFn?: typeof syncRecords;
  insertLogFn?: typeof insertLog;
  setSyncing: (syncing: boolean) => void;
  setMappingStatus: (status: "idle" | "loading" | "saving" | "saved" | "error") => void;
  setMappingError: (err: string | null) => void;
  setSyncProgress: (progress: { synced: number; total: number }) => void;
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
    failedSyncIds,
    syncedCount,
    provider,
    calculating,
    syncing,
    upsertMappingFn = upsertMapping,
    syncRecordsFn = syncRecords,
    insertLogFn = insertLog,
    setSyncing,
    setMappingStatus,
    setMappingError,
    setSyncProgress,
    setFailedSyncIds,
    setSyncedCount,
    setShowSummary,
    toast,
  } = params;

  if (!distances.length || !selectedTable || !user) return;
  if (calculating || syncing) return;

  if (!startCol || !endCol || !distanceCol) {
    toast({
      title: "Mapping required",
      description: "Please map Start, End, and Distance columns.",
      variant: "destructive",
    });
    return;
  }

  setSyncing(true);

  // 1. Await and confirm mapping persistence before initiating Airtable sync
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

  // 2. Build sync records; if retrying after partial failure, only send failed records
  const withPurpose = distances.map((d) => ({ ...d, purposeText: purposes[d.record_id] }));
  const allSyncRecords = buildSyncRecords(
    withPurpose,
    { cost: Boolean(costCol), status: Boolean(statusCol), purpose: Boolean(purposeCol) },
    ratePerUnit,
    rateUnit,
  );

  const recordsToSync = failedSyncIds.length > 0
    ? allSyncRecords.filter((r) => failedSyncIds.includes(r.id))
    : allSyncRecords;

  setSyncProgress({ synced: 0, total: recordsToSync.length });

  try {
    const result: SyncResult = await syncRecordsFn(
      {
        baseId: selectedBase,
        tableId: selectedTable,
        records: recordsToSync,
      },
      (synced, total) => setSyncProgress({ synced, total })
    );

    // Track failed records for safe retry
    setFailedSyncIds(result.failedIds);

    // Accumulate confirmed writes
    const previouslySynced = syncedCount ?? 0;
    const totalSyncedNow = previouslySynced + result.synced;
    setSyncedCount(totalSyncedNow);
    setShowSummary(true);

    // 3. Audit log reflects actual confirmed writes only; log failure must not report sync failure
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

    // 4. Distinguish 100% success, partial success, and 0% failure
    if (result.synced > 0 && result.failed === 0) {
      toast({
        title: "Sync complete",
        description: `All ${result.synced} records updated successfully.`,
      });
    } else if (result.synced > 0 && result.failed > 0) {
      toast({
        title: "Partial sync",
        description: `${result.synced} records updated, ${result.failed} records failed. You can retry the failed records.`,
        variant: "destructive",
      });
    } else if (result.failed > 0) {
      toast({
        title: "Sync failed",
        description: `All ${result.failed} records failed to sync. ${result.errors[0] || ""}`,
        variant: "destructive",
      });
    }
  } catch (e: unknown) {
    toast({ title: "Sync failed", description: (e as Error).message, variant: "destructive" });
  } finally {
    setSyncing(false);
  }
}
