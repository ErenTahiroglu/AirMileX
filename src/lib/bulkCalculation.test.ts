import { describe, expect, it, vi } from "vitest";
import {
  executeBulkDistanceCalculation,
  filterValidAddressPairs,
  InsufficientCreditsError,
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
  });
});
