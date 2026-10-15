import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeJobSync, type ExecuteJobSyncParams } from "./newJobSync";
import type { DistanceResult } from "@/services/distance";
import type { SyncResult } from "@/services/airtable";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

describe("newJobSync orchestrator", () => {
  let params: ExecuteJobSyncParams;
  let mockUpsertMapping: ReturnType<typeof vi.fn>;
  let mockSyncRecords: ReturnType<typeof vi.fn>;
  let mockInsertLog: ReturnType<typeof vi.fn>;
  let mockSetSyncing: ReturnType<typeof vi.fn>;
  let mockSetMappingStatus: ReturnType<typeof vi.fn>;
  let mockSetMappingError: ReturnType<typeof vi.fn>;
  let mockSetSyncProgress: ReturnType<typeof vi.fn>;
  let mockSetFailedSyncIds: ReturnType<typeof vi.fn>;
  let mockSetSyncedCount: ReturnType<typeof vi.fn>;
  let mockSetShowSummary: ReturnType<typeof vi.fn>;
  let mockToast: ReturnType<typeof vi.fn>;

  const sampleDistances: DistanceResult[] = [
    { record_id: "rec1", distance_km: 16.09, distance_mi: 10, status: "ok" },
    { record_id: "rec2", distance_km: 32.18, distance_mi: 20, status: "ok" },
    { record_id: "rec3", distance_km: 0, distance_mi: 0, status: "error" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertMapping = vi.fn().mockResolvedValue({} as any);
    mockSyncRecords = vi.fn();
    mockInsertLog = vi.fn().mockResolvedValue(undefined);
    mockSetSyncing = vi.fn();
    mockSetMappingStatus = vi.fn();
    mockSetMappingError = vi.fn();
    mockSetSyncProgress = vi.fn();
    mockSetFailedSyncIds = vi.fn();
    mockSetSyncedCount = vi.fn();
    mockSetShowSummary = vi.fn();
    mockToast = vi.fn();

    params = {
      user: { id: "usr1" },
      selectedBase: "appBase",
      selectedTable: "tbl1",
      startCol: "fldStart",
      endCol: "fldEnd",
      distanceCol: "fldDist",
      costCol: "fldCost",
      statusCol: "fldStatus",
      notesCol: "",
      purposeCol: "",
      ratePerUnit: 0.76,
      rateUnit: "mi",
      distances: sampleDistances,
      purposes: {},
      failedSyncIds: [],
      syncedCount: null,
      provider: "google",
      calculating: false,
      syncing: false,
      upsertMappingFn: mockUpsertMapping,
      syncRecordsFn: mockSyncRecords,
      insertLogFn: mockInsertLog,
      setSyncing: mockSetSyncing,
      setMappingStatus: mockSetMappingStatus,
      setMappingError: mockSetMappingError,
      setSyncProgress: mockSetSyncProgress,
      setFailedSyncIds: mockSetFailedSyncIds,
      setSyncedCount: mockSetSyncedCount,
      setShowSummary: mockSetShowSummary,
      toast: mockToast,
    };
  });

  it("1. Full success: confirms persistence, syncs all records, logs audit, and notifies success", async () => {
    const successResult: SyncResult = {
      synced: 3,
      failed: 0,
      errors: [],
      succeededIds: ["rec1", "rec2", "rec3"],
      failedIds: [],
    };
    mockSyncRecords.mockResolvedValue(successResult);

    await executeJobSync(params);

    // Confirms mapping persistence before Airtable sync
    expect(mockUpsertMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "usr1",
        table_id: "tbl1",
        start_col_id: "fldStart",
        end_col_id: "fldEnd",
        distance_col_id: "fldDist",
      })
    );
    expect(mockSetMappingStatus).toHaveBeenCalledWith("saved");

    // Sync records called with all 3 records
    expect(mockSyncRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        baseId: "appBase",
        tableId: "tbl1",
        records: expect.arrayContaining([
          expect.objectContaining({ id: "rec1" }),
          expect.objectContaining({ id: "rec2" }),
          expect.objectContaining({ id: "rec3" }),
        ]),
      }),
      expect.any(Function)
    );

    // Succeeded count updated and audit log inserted
    expect(mockSetFailedSyncIds).toHaveBeenCalledWith([]);
    expect(mockSetSyncedCount).toHaveBeenCalledWith(3);
    expect(mockInsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "usr1",
        base_id: "appBase",
        table_id: "tbl1",
        records_processed: 3,
      })
    );
    expect(mockToast).toHaveBeenCalledWith({
      title: "Sync complete",
      description: "All 3 records updated successfully.",
    });
  });

  it("2. Partial success: tracks failed record IDs and notifies partial failure without claiming unconfirmed writes", async () => {
    const partialResult: SyncResult = {
      synced: 2,
      failed: 1,
      errors: ["Record rec3 update failed"],
      succeededIds: ["rec1", "rec2"],
      failedIds: ["rec3"],
    };
    mockSyncRecords.mockResolvedValue(partialResult);

    await executeJobSync(params);

    expect(mockSetFailedSyncIds).toHaveBeenCalledWith(["rec3"]);
    expect(mockSetSyncedCount).toHaveBeenCalledWith(2);
    expect(mockInsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        records_processed: 2,
      })
    );
    expect(mockToast).toHaveBeenCalledWith({
      title: "Partial sync",
      description: "2 records updated, 1 records failed. You can retry the failed records.",
      variant: "destructive",
    });
  });

  it("3. Complete failure: handles 0 writes, marks all failed, skips audit log", async () => {
    const failureResult: SyncResult = {
      synced: 0,
      failed: 3,
      errors: ["Airtable 422: Unprocessable Entity"],
      succeededIds: [],
      failedIds: ["rec1", "rec2", "rec3"],
    };
    mockSyncRecords.mockResolvedValue(failureResult);

    await executeJobSync(params);

    expect(mockSetFailedSyncIds).toHaveBeenCalledWith(["rec1", "rec2", "rec3"]);
    expect(mockSetSyncedCount).toHaveBeenCalledWith(0);
    // When 0 records synced, audit log must NOT record any processed records
    expect(mockInsertLog).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Sync failed",
        variant: "destructive",
      })
    );
  });

  it("4. Failed-record retry: only resends failed records and accumulates confirmed counts", async () => {
    // Retry scenario: previously rec1 and rec2 succeeded, rec3 failed
    params.failedSyncIds = ["rec3"];
    params.syncedCount = 2;

    const retryResult: SyncResult = {
      synced: 1,
      failed: 0,
      errors: [],
      succeededIds: ["rec3"],
      failedIds: [],
    };
    mockSyncRecords.mockResolvedValue(retryResult);

    await executeJobSync(params);

    // Verify only rec3 was sent in payload, never rec1 or rec2
    expect(mockSyncRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [expect.objectContaining({ id: "rec3" })],
      }),
      expect.any(Function)
    );

    // Total synced count accumulated: 2 + 1 = 3
    expect(mockSetSyncedCount).toHaveBeenCalledWith(3);
    expect(mockSetFailedSyncIds).toHaveBeenCalledWith([]);
    expect(mockInsertLog).toHaveBeenCalledWith(
      expect.objectContaining({
        records_processed: 1,
      })
    );
  });

  it("5. Audit-log failure: does not report sync failure when Airtable write succeeds", async () => {
    const successResult: SyncResult = {
      synced: 2,
      failed: 0,
      errors: [],
      succeededIds: ["rec1", "rec2"],
      failedIds: [],
    };
    mockSyncRecords.mockResolvedValue(successResult);
    mockInsertLog.mockRejectedValue(new Error("Database connection lost"));

    await executeJobSync(params);

    // Sync is still marked complete for the user
    expect(mockSetSyncedCount).toHaveBeenCalledWith(2);
    // Audit log failure shows a distinct notice toast, NOT a sync failed toast
    expect(mockToast).toHaveBeenCalledWith({
      title: "Audit log notice",
      description: "Records were updated in Airtable, but the local audit log could not be saved.",
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: "Sync complete",
      description: "All 2 records updated successfully.",
    });
  });

  it("6. Mapping persistence failure: blocks Airtable sync if mapping fails to persist", async () => {
    mockUpsertMapping.mockRejectedValue(new Error("Supabase RLS violation"));

    await executeJobSync(params);

    expect(mockSetMappingStatus).toHaveBeenCalledWith("error");
    expect(mockSetMappingError).toHaveBeenCalledWith("Supabase RLS violation");
    // Sync must NOT be initiated
    expect(mockSyncRecords).not.toHaveBeenCalled();
    expect(mockInsertLog).not.toHaveBeenCalled();
    expect(mockSetSyncing).toHaveBeenCalledWith(false);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Cannot sync to Airtable",
        description: expect.stringContaining("Column mapping must be saved before syncing"),
        variant: "destructive",
      })
    );
  });
});
