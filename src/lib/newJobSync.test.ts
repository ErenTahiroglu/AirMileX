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
    mockSetConfirmedSyncIds = vi.fn();
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
      confirmedSyncIds: [],
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
      setConfirmedSyncIds: mockSetConfirmedSyncIds,
      setFailedSyncIds: mockSetFailedSyncIds,
      setSyncedCount: mockSetSyncedCount,
      setShowSummary: mockSetShowSummary,
      toast: mockToast,
    };
  });

  let mockSetConfirmedSyncIds: ReturnType<typeof vi.fn>;

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
    expect(mockSetConfirmedSyncIds).toHaveBeenCalledWith(["rec1", "rec2", "rec3"]);
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

  it("2. Partial sync -> retry -> full success (never resends confirmed records)", async () => {
    // Initial attempt: rec1 and rec2 succeed, rec3 fails
    const partialResult: SyncResult = {
      synced: 2,
      failed: 1,
      errors: ["Record rec3 update failed"],
      succeededIds: ["rec1", "rec2"],
      failedIds: ["rec3"],
    };
    mockSyncRecords.mockResolvedValue(partialResult);

    await executeJobSync(params);

    expect(mockSetConfirmedSyncIds).toHaveBeenCalledWith(["rec1", "rec2"]);
    expect(mockSetFailedSyncIds).toHaveBeenCalledWith(["rec3"]);
    expect(mockSetSyncedCount).toHaveBeenCalledWith(2);
    expect(mockInsertLog).toHaveBeenCalledWith(expect.objectContaining({ records_processed: 2 }));

    // Now user clicks Retry: confirmedSyncIds has ["rec1", "rec2"], failedSyncIds has ["rec3"]
    vi.clearAllMocks();
    params.confirmedSyncIds = ["rec1", "rec2"];
    params.failedSyncIds = ["rec3"];

    const retrySuccessResult: SyncResult = {
      synced: 1,
      failed: 0,
      errors: [],
      succeededIds: ["rec3"],
      failedIds: [],
    };
    mockSyncRecords.mockResolvedValue(retrySuccessResult);

    await executeJobSync(params);

    // Only rec3 was sent on retry!
    expect(mockSyncRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [expect.objectContaining({ id: "rec3" })],
      }),
      expect.any(Function)
    );

    // All confirmed: rec1, rec2, rec3
    expect(mockSetConfirmedSyncIds).toHaveBeenCalledWith(["rec1", "rec2", "rec3"]);
    expect(mockSetFailedSyncIds).toHaveBeenCalledWith([]);
    expect(mockSetSyncedCount).toHaveBeenCalledWith(3);
    // Audit log only logs the 1 newly confirmed record (never duplicates)
    expect(mockInsertLog).toHaveBeenCalledWith(expect.objectContaining({ records_processed: 1 }));
  });

  it("3. Repeated sync after full success: blocked, never resends confirmed records or duplicates logs", async () => {
    // All 3 records already confirmed
    params.confirmedSyncIds = ["rec1", "rec2", "rec3"];
    params.failedSyncIds = [];

    await executeJobSync(params);

    expect(mockSyncRecords).not.toHaveBeenCalled();
    expect(mockInsertLog).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: "All records synced",
      description: "All records for this job have already been confirmed in Airtable.",
    });
  });

  it("4. Indeterminate network outcome: distinguishes network drops without claiming definite failure", async () => {
    const indeterminateResult: SyncResult = {
      synced: 0,
      failed: 0,
      indeterminate: 3,
      errors: ["Network timeout while connecting to Airtable proxy"],
      succeededIds: [],
      failedIds: [],
      indeterminateIds: ["rec1", "rec2", "rec3"],
    };
    mockSyncRecords.mockResolvedValue(indeterminateResult);

    await executeJobSync(params);

    expect(mockSetConfirmedSyncIds).toHaveBeenCalledWith([]);
    // Indeterminate IDs are retained for retry
    expect(mockSetFailedSyncIds).toHaveBeenCalledWith(["rec1", "rec2", "rec3"]);
    expect(mockInsertLog).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: "Sync outcome indeterminate",
      description: "Network error occurred. 3 record(s) could not be confirmed in Airtable. You can retry.",
      variant: "destructive",
    });
  });

  it("5. AI generation pending during sync: blocks sync from proceeding without generated purposes", async () => {
    params.generatingPurposes = true;
    params.purposeCol = "fldPurpose";

    await executeJobSync(params);

    // Sync is blocked while AI is generating
    expect(mockSyncRecords).not.toHaveBeenCalled();
    expect(mockInsertLog).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: "AI purposes generating",
      description: "Please wait for AI business purposes to finish generating before syncing.",
      variant: "destructive",
    });
  });

  it("6. Audit-log failure: does not report sync failure when Airtable write succeeds", async () => {
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

    expect(mockSetSyncedCount).toHaveBeenCalledWith(2);
    expect(mockToast).toHaveBeenCalledWith({
      title: "Audit log notice",
      description: "Records were updated in Airtable, but the local audit log could not be saved.",
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: "Sync complete",
      description: "All 2 records updated successfully.",
    });
  });

  it("7. Mapping persistence failure: blocks Airtable sync if mapping fails to persist", async () => {
    mockUpsertMapping.mockRejectedValue(new Error("Supabase RLS violation"));

    await executeJobSync(params);

    expect(mockSetMappingStatus).toHaveBeenCalledWith("error");
    expect(mockSetMappingError).toHaveBeenCalledWith("Supabase RLS violation");
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
