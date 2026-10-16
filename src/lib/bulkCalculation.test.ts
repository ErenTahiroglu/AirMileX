import { describe, expect, it, vi } from "vitest";
import {
  executeBulkDistanceCalculation,
  filterValidAddressPairs,
  InsufficientCreditsError,
  partitionRecordsForContinuation,
  formatCalculationNotification,
  isIndeterminateResult,
  type BulkRecordInput,
} from "./bulkCalculation";
import type { AddressPair, CalculateDistancesResponse, DistanceResult } from "@/services/distance";

describe("AirMileX Phase 2B: Bulk Distance Calculation Orchestrator", () => {
  const sampleRecords: BulkRecordInput[] = [
    { id: "rec1", start: "100 Main St, NY", end: "200 Main St, NY" },
    { id: "rec2", start: "300 Market St, SF", end: "400 Market St, SF" },
    { id: "rec3", start: "", end: "500 Elm St, Chicago" }, // Missing start
    { id: "rec4", start: "600 Broadway, NY", end: "" }, // Missing end
    { id: "rec5", start: "   ", end: "   " }, // Empty whitespace
    { id: "rec6", start: "700 Pine St, Seattle", end: "800 Pine St, Seattle" },
  ];

  it("1. Address filtering: excludes empty/invalid pairs before calculating required credits", () => {
    const { valid, invalidResults } = filterValidAddressPairs(sampleRecords);

    // Only 3 valid records (rec1, rec2, rec6)
    expect(valid.map((r) => r.id)).toEqual(["rec1", "rec2", "rec6"]);

    // 3 invalid records excluded immediately with error status without charging credits
    expect(invalidResults.length).toBe(3);
    expect(invalidResults.map((r) => r.record_id)).toEqual(["rec3", "rec4", "rec5"]);
    expect(invalidResults.every((r) => r.status === "error")).toBe(true);
    expect(invalidResults[0].error).toContain("Missing start or destination address");
  });

  it("2. Credit check: blocks execution clearly if available credits are insufficient for valid pairs", async () => {
    const mockCalculate = vi.fn();

    // 3 valid records in sampleRecords, but only 2 credits available
    await expect(
      executeBulkDistanceCalculation(sampleRecords, {
        availableCredits: 2,
        calculateDistancesFn: mockCalculate,
      })
    ).rejects.toThrow(InsufficientCreditsError);

    // Calculation was blocked BEFORE starting any requests; zero calls made
    expect(mockCalculate).not.toHaveBeenCalled();
  });

  it("3. Batch size: starts with configurable 5 records per request by default and passes is_bulk: true", async () => {
    const tenRecords: BulkRecordInput[] = Array.from({ length: 12 }, (_, i) => ({
      id: `rec_${i}`,
      start: `Start Address ${i}`,
      end: `End Address ${i}`,
    }));

    const capturedBatches: AddressPair[][] = [];
    const capturedOptions: Array<{ is_bulk?: boolean } | undefined> = [];

    const mockCalculate = vi.fn().mockImplementation(async (pairs: AddressPair[], opts) => {
      capturedBatches.push(pairs);
      capturedOptions.push(opts);
      return {
        results: pairs.map((p) => ({
          record_id: p.record_id,
          distance_km: 16.09,
          distance_mi: 10,
          status: "ok" as const,
        })),
        credits_remaining: 100 - pairs.length,
      };
    });

    const result = await executeBulkDistanceCalculation(tenRecords, {
      availableCredits: 50,
      batchSize: 5, // Default requirement: 5 records per batch
      calculateDistancesFn: mockCalculate,
    });

    // 12 records with batch size 5 = 3 batches (5, 5, 2)
    expect(capturedBatches.length).toBe(3);
    expect(capturedBatches[0].length).toBe(5);
    expect(capturedBatches[1].length).toBe(5);
    expect(capturedBatches[2].length).toBe(2);

    // Every batch passed is_bulk: true
    expect(capturedOptions.every((opt) => opt?.is_bulk === true)).toBe(true);

    expect(result.results.length).toBe(12);
    expect(result.summary.ok).toBe(12);
    expect(result.summary.error).toBe(0);
  });

  it("4. Result preservation: invokes onBatchComplete immediately after each batch so results are preserved", async () => {
    const eightRecords: BulkRecordInput[] = Array.from({ length: 8 }, (_, i) => ({
      id: `rec_${i}`,
      start: `Start Address ${i}`,
      end: `End Address ${i}`,
    }));

    const completedBatches: DistanceResult[][] = [];
    const mockCalculate = vi.fn().mockImplementation(async (pairs: AddressPair[]) => ({
      results: pairs.map((p) => ({
        record_id: p.record_id,
        distance_km: 10,
        distance_mi: 6.2,
        status: "ok" as const,
      })),
      credits_remaining: 80,
    }));

    await executeBulkDistanceCalculation(eightRecords, {
      availableCredits: 20,
      batchSize: 5,
      onBatchComplete: (batchResults) => {
        completedBatches.push(batchResults);
      },
      calculateDistancesFn: mockCalculate,
    });

    // Batch 1 (5 records) and Batch 2 (3 records) were preserved immediately via callback
    expect(completedBatches.length).toBe(2);
    expect(completedBatches[0].length).toBe(5);
    expect(completedBatches[1].length).toBe(3);
  });

  it("5. Cancellation: stops scheduling NEW batches without aborting in-flight requests", async () => {
    const tenRecords: BulkRecordInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `rec_${i}`,
      start: `Start Address ${i}`,
      end: `End Address ${i}`,
    }));

    let shouldCancel = false;
    let callCount = 0;

    const mockCalculate = vi.fn().mockImplementation(async (pairs: AddressPair[]) => {
      callCount++;
      // User clicks Cancel after batch 1 completes
      if (callCount === 1) {
        shouldCancel = true;
      }
      return {
        results: pairs.map((p) => ({
          record_id: p.record_id,
          distance_km: 10,
          distance_mi: 6.2,
          status: "ok" as const,
        })),
        credits_remaining: 50,
      };
    });

    const result = await executeBulkDistanceCalculation(tenRecords, {
      availableCredits: 20,
      batchSize: 5,
      isCancelled: () => shouldCancel,
      calculateDistancesFn: mockCalculate,
    });

    // Only batch 1 was executed (5 records), batch 2 was NEVER dispatched
    expect(callCount).toBe(1);
    expect(mockCalculate).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    // Batch 1 results are preserved
    expect(result.summary.ok).toBe(5);
  });

  it("6. Indeterminate network outcomes: marks timeout/drop as indeterminate without auto-retrying", async () => {
    const sixRecords: BulkRecordInput[] = Array.from({ length: 6 }, (_, i) => ({
      id: `rec_${i}`,
      start: `Start Address ${i}`,
      end: `End Address ${i}`,
    }));

    let callCount = 0;
    const mockCalculate = vi.fn().mockImplementation(async (pairs: AddressPair[]) => {
      callCount++;
      if (callCount === 1) {
        // First batch succeeds
        return {
          results: pairs.map((p) => ({
            record_id: p.record_id,
            distance_km: 10,
            distance_mi: 6.2,
            status: "ok" as const,
          })),
        };
      }
      // Second batch encounters network timeout
      throw new Error("504 Gateway Timeout: Edge Function took too long");
    });

    const result = await executeBulkDistanceCalculation(sixRecords, {
      availableCredits: 10,
      batchSize: 5,
      calculateDistancesFn: mockCalculate,
    });

    // 2 calls made, batch 2 failed with indeterminate error
    expect(callCount).toBe(2);
    // 5 records ok from batch 1
    expect(result.summary.ok).toBe(5);
    // 1 record indeterminate from batch 2
    expect(result.summary.indeterminate).toBe(1);

    const indetRecord = result.results.find((r) => r.record_id === "rec_5");
    expect(indetRecord?.status).toBe("error");
    expect(indetRecord?.error).toContain("Indeterminate network outcome");
    expect(indetRecord?.error_type).toBe("indeterminate");
  });

  it("7. Task 1: Authoritative balance: fully successful batch updates displayed credits with authoritative balance", async () => {
    const records: BulkRecordInput[] = [
      { id: "rec1", start: "100 Main St", end: "200 Main St" },
    ];

    let receivedCredits: number | undefined;

    const mockCalculate = vi.fn().mockResolvedValue({
      results: [{ record_id: "rec1", distance_km: 10, distance_mi: 6.2, status: "ok" as const }],
      credits_remaining: 485, // Authoritative balance returned by server
    });

    const result = await executeBulkDistanceCalculation(records, {
      availableCredits: 500,
      onBatchComplete: (_batch, creditsRemaining) => {
        receivedCredits = creditsRemaining;
      },
      calculateDistancesFn: mockCalculate,
    });

    // Client receives authoritative server balance 485, never blindly guessing 500 - 1
    expect(receivedCredits).toBe(485);
    expect(result.creditsRemaining).toBe(485);
  });

  it("8. Task 5: Provider configuration failure: stops bulk job immediately after first failure without dispatching remaining batches", async () => {
    const tenRecords: BulkRecordInput[] = Array.from({ length: 10 }, (_, i) => ({
      id: `rec_${i}`,
      start: `Start Address ${i}`,
      end: `End Address ${i}`,
    }));

    let callCount = 0;
    const mockCalculate = vi.fn().mockImplementation(async () => {
      callCount++;
      // Server rejects with configuration error BEFORE reserving credits
      throw new Error("Operator map service is not configured for bulk operations. Please contact support.");
    });

    const result = await executeBulkDistanceCalculation(tenRecords, {
      availableCredits: 100,
      batchSize: 5,
      calculateDistancesFn: mockCalculate,
    });

    // Stopped immediately after batch 1; batch 2 was NEVER dispatched!
    expect(callCount).toBe(1);
    expect(mockCalculate).toHaveBeenCalledTimes(1);
    expect(result.summary.error).toBe(5);

    const firstResult = result.results[0];
    expect(firstResult.status).toBe("error");
    expect(firstResult.error).toContain("not configured");
    expect(firstResult.error_type).toBe("provider");
  });

  it("9. Task B1: Continuation partition excludes BOTH confirmed-success and indeterminate records, even when 0 records succeeded", () => {
    const preview = [
      { id: "rec1", start: "100 Main St", end: "200 Main St" },
      { id: "rec2", start: "300 Market St", end: "400 Market St" },
      { id: "rec3", start: "500 Elm St", end: "600 Elm St" },
      { id: "rec4", start: "700 Pine St", end: "800 Pine St" },
    ];

    // Scenario: First batch had 2 records: 1 failed with regular error, 1 failed with indeterminate network drop. 0 ok records!
    const distances: DistanceResult[] = [
      {
        record_id: "rec1",
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Address not found",
        error_type: "not_found",
      },
      {
        record_id: "rec2",
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Indeterminate network outcome: 504 Gateway Timeout",
        error_type: "indeterminate",
      },
    ];

    const {
      okRecordIds,
      indeterminateRecordIds,
      remainingToCalculate,
      indeterminateRecords,
    } = partitionRecordsForContinuation(preview, distances);

    expect(okRecordIds.size).toBe(0);
    expect(indeterminateRecordIds.size).toBe(1);
    expect(indeterminateRecordIds.has("rec2")).toBe(true);

    // Normal continuation MUST NOT contain rec2 (indeterminate) even though okRecordIds.size === 0!
    // It should contain rec1 (can be re-run or skipped) and rec3, rec4 (uncalculated).
    expect(remainingToCalculate.map((r) => r.id)).toEqual(["rec1", "rec3", "rec4"]);
    expect(remainingToCalculate.some((r) => r.id === "rec2")).toBe(false);

    // Indeterminate records are separated out for explicit user confirmation
    expect(indeterminateRecords.map((r) => r.id)).toEqual(["rec2"]);
  });

  it("10. Task B1: When records succeed and some are indeterminate, normal continuation excludes both", () => {
    const preview = [
      { id: "rec1" },
      { id: "rec2" },
      { id: "rec3" },
      { id: "rec4" },
    ];

    const distances: DistanceResult[] = [
      { record_id: "rec1", distance_km: 10, distance_mi: 6.2, status: "ok" },
      {
        record_id: "rec2",
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Indeterminate network outcome: connection reset",
        error_type: "indeterminate",
      },
    ];

    const { remainingToCalculate, indeterminateRecords } = partitionRecordsForContinuation(
      preview,
      distances
    );

    // rec1 (ok) and rec2 (indeterminate) are BOTH excluded from remainingToCalculate
    expect(remainingToCalculate.map((r) => r.id)).toEqual(["rec3", "rec4"]);
    expect(indeterminateRecords.map((r) => r.id)).toEqual(["rec2"]);
  });

  it("11. Task B2: Captures backend refund_error and surfaces it in BulkCalculationResult and onBatchComplete", async () => {
    const records: BulkRecordInput[] = [
      { id: "rec1", start: "100 Main St", end: "200 Main St" },
    ];

    let batchRefundError: string | undefined;

    const mockCalculate = vi.fn().mockResolvedValue({
      results: [
        {
          record_id: "rec1",
          distance_km: 0,
          distance_mi: 0,
          status: "error" as const,
          error: "Address not found",
          error_type: "not_found" as const,
        },
      ],
      credits_remaining: 10,
      refund_error: "Refund RPC failed for 1 credit: Connection timeout",
    });

    const result = await executeBulkDistanceCalculation(records, {
      availableCredits: 10,
      onBatchComplete: (_batch, _credits, refundError) => {
        batchRefundError = refundError;
      },
      calculateDistancesFn: mockCalculate,
    });

    expect(batchRefundError).toBe("Refund RPC failed for 1 credit: Connection timeout");
    expect(result.refundErrors).toEqual(["Refund RPC failed for 1 credit: Connection timeout"]);
  });

  it("12. Task B2: Refreshes authoritative credit balance from DB when refund_error occurs", async () => {
    const records: BulkRecordInput[] = [
      { id: "rec1", start: "100 Main St", end: "200 Main St" },
    ];

    const mockCalculate = vi.fn().mockResolvedValue({
      results: [
        {
          record_id: "rec1",
          distance_km: 0,
          distance_mi: 0,
          status: "error" as const,
          error: "Address not found",
        },
      ],
      credits_remaining: 9, // Pre-refund balance
      refund_error: "Refund RPC failed",
    });

    const mockFetchAuthoritativeCredits = vi.fn().mockResolvedValue(9);

    const result = await executeBulkDistanceCalculation(records, {
      availableCredits: 10,
      calculateDistancesFn: mockCalculate,
      fetchAuthoritativeCreditsFn: mockFetchAuthoritativeCredits,
    });

    // Authoritative balance was actively refreshed because a refund error occurred
    expect(mockFetchAuthoritativeCredits).toHaveBeenCalledTimes(1);
    expect(result.creditsRemaining).toBe(9);
    expect(result.refundErrors).toContain("Refund RPC failed");
  });

  it("13. Task B2: formatCalculationNotification surfaces refund errors explicitly and never falsely claims failed rows were refunded", () => {
    // Case A: Calculation has refund error -> destructive variant, explicit refund failure warning
    const notifWithError = formatCalculationNotification(
      { total: 5, ok: 3, error: 2, indeterminate: 0, skippedEmpty: 0 },
      ["Refund RPC failed for 2 credits"]
    );
    expect(notifWithError.variant).toBe("destructive");
    expect(notifWithError.title).toContain("refund errors");
    expect(notifWithError.description).toContain("automatic credit refund failed (Refund RPC failed for 2 credits)");
    expect(notifWithError.description).not.toContain("credits refunded");

    // Case B: Calculation has errors but NO refund error -> confirmed refund stated
    const notifRefunded = formatCalculationNotification(
      { total: 5, ok: 3, error: 2, indeterminate: 0, skippedEmpty: 0 },
      []
    );
    expect(notifRefunded.variant).toBe("default");
    expect(notifRefunded.title).toBe("Calculation completed");
    expect(notifRefunded.description).toContain("3 succeeded");
    expect(notifRefunded.description).toContain("2 failed (credits refunded)");

    // Case C: Calculation has indeterminate rows -> explicitly states not refunded
    const notifIndet = formatCalculationNotification(
      { total: 5, ok: 3, error: 0, indeterminate: 2, skippedEmpty: 0 },
      []
    );
    expect(notifIndet.description).toContain("2 indeterminate (not refunded)");
    expect(notifIndet.description).not.toContain("credits refunded");
  });
});

