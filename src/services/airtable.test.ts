import { describe, expect, it, vi, beforeEach } from "vitest";
import { syncRecords, type SyncRecord } from "./airtable";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
      },
      functions: {
        invoke: vi.fn(),
      },
    },
  };
});

// Mock rateLimiter so tests run immediately without waiting 250ms
vi.mock("@/lib/rateLimiter", () => ({
  runBatched: async (items: any[], fn: any, opts: any) => {
    const results = [];
    const size = opts?.batchSize ?? 5;
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      results.push(await fn(batch));
      opts?.onProgress?.(Math.min(i + batch.length, items.length), items.length);
    }
    return results;
  },
  sleep: vi.fn().mockResolvedValue(undefined),
}));

describe("airtable synchronization service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: { user: { id: "usr1" } } as unknown as any,
      },
      error: null,
    });
  });

  const makeRecords = (count: number): SyncRecord[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `rec${String(i + 1).padStart(14, "0")}`,
      distance: "10.00 mi",
      status: "Hesaplandı",
    }));

  it("handles empty record list gracefully", async () => {
    const res = await syncRecords({ baseId: "appBase", tableId: "tbl1", records: [] });
    expect(res).toEqual({
      synced: 0,
      failed: 0,
      indeterminate: 0,
      errors: [],
      succeededIds: [],
      failedIds: [],
      indeterminateIds: [],
    });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("reports 100% synchronization success when all batches succeed", async () => {
    const records = makeRecords(10); // 2 batches of 5
    (supabase.functions.invoke as any).mockImplementation(async (_fn, options) => {
      const batch = (options?.body as any).records;
      return {
        data: {
          synced: batch.length,
          failed: 0,
          errors: [],
          succeededIds: batch.map((r: any) => r.id),
          failedIds: [],
        },
        error: null,
      };
    });

    const res = await syncRecords({ baseId: "appBase", tableId: "tbl1", records });

    expect(res.synced).toBe(10);
    expect(res.failed).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.succeededIds).toHaveLength(10);
    expect(res.failedIds).toHaveLength(0);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
  });

  it("reports partial synchronization success when some batches fail", async () => {
    const records = makeRecords(10); // Batch 1: records 0-4, Batch 2: records 5-9
    let callCount = 0;

    (supabase.functions.invoke as any).mockImplementation(async (_fn, options) => {
      callCount++;
      const batch = (options?.body as any).records;
      if (callCount === 1) {
        // First batch succeeds
        return {
          data: {
            synced: 5,
            failed: 0,
            errors: [],
            succeededIds: batch.map((r: any) => r.id),
            failedIds: [],
          },
          error: null,
        };
      } else {
        // Second batch fails
        return {
          data: null,
          error: { message: "Airtable API rate limit exceeded (429)" } as any,
        };
      }
    });

    const res = await syncRecords({ baseId: "appBase", tableId: "tbl1", records });

    expect(res.synced).toBe(5);
    expect(res.failed).toBe(5);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("429");
    expect(res.succeededIds).toEqual(records.slice(0, 5).map((r) => r.id));
    expect(res.failedIds).toEqual(records.slice(5, 10).map((r) => r.id));
  });

  it("reports 0% synchronization success when all batches fail", async () => {
    const records = makeRecords(10);
    (supabase.functions.invoke as any).mockImplementation(async () => {
      return {
        data: null,
        error: { message: "Airtable 422: Unprocessable Entity" } as any,
      };
    });

    const res = await syncRecords({ baseId: "appBase", tableId: "tbl1", records });

    expect(res.synced).toBe(0);
    expect(res.failed).toBe(10);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.succeededIds).toHaveLength(0);
    expect(res.failedIds).toEqual(records.map((r) => r.id));
  });

  it("supports retrying failed records without resending succeeded records", async () => {
    const records = makeRecords(10);
    let callCount = 0;

    // First attempt: batch 1 succeeds, batch 2 fails
    (supabase.functions.invoke as any).mockImplementation(async (_fn, options) => {
      callCount++;
      const batch = (options?.body as any).records;
      if (callCount === 1) {
        return {
          data: {
            synced: 5,
            failed: 0,
            errors: [],
            succeededIds: batch.map((r: any) => r.id),
            failedIds: [],
          },
          error: null,
        };
      }
      return {
        data: null,
        error: { message: "Server error" } as any,
      };
    });

    const initialResult = await syncRecords({ baseId: "appBase", tableId: "tbl1", records });
    expect(initialResult.synced).toBe(5);
    expect(initialResult.failed).toBe(5);
    const failedIds = initialResult.failedIds;

    // Retry only the failed records
    const recordsToRetry = records.filter((r) => failedIds.includes(r.id));
    expect(recordsToRetry).toHaveLength(5);

    // Second attempt: all retried records succeed
    (supabase.functions.invoke as any).mockImplementation(async (_fn, options) => {
      const batch = (options?.body as any).records;
      return {
        data: {
          synced: batch.length,
          failed: 0,
          errors: [],
          succeededIds: batch.map((r: any) => r.id),
          failedIds: [],
        },
        error: null,
      };
    });

    const retryResult = await syncRecords({ baseId: "appBase", tableId: "tbl1", records: recordsToRetry });
    expect(retryResult.synced).toBe(5);
    expect(retryResult.failed).toBe(0);
    expect(retryResult.succeededIds).toEqual(failedIds);
  });

  it("reports accurate progress and distinguishes confirmed vs failed/indeterminate without claiming processed as synced", async () => {
    const records = makeRecords(10);
    const progressUpdates: any[] = [];
    let callCount = 0;

    // Batch 1 succeeds, Batch 2 fails
    (supabase.functions.invoke as any).mockImplementation(async (_fn, options) => {
      callCount++;
      const batch = (options?.body as any).records;
      if (callCount === 1) {
        return {
          data: {
            synced: 5,
            failed: 0,
            errors: [],
            succeededIds: batch.map((r: any) => r.id),
            failedIds: [],
          },
          error: null,
        };
      }
      return {
        data: null,
        error: { message: "Internal server error" },
      };
    });

    const res = await syncRecords(
      { baseId: "appBase", tableId: "tbl1", records },
      (progress) => progressUpdates.push({ ...progress })
    );

    expect(res.synced).toBe(5);
    expect(res.failed).toBe(5);
    expect(progressUpdates).toHaveLength(2);

    // Batch 1 progress
    expect(progressUpdates[0]).toEqual({
      processed: 5,
      confirmed: 5,
      failed: 0,
      indeterminate: 0,
      total: 10,
    });

    // Batch 2 progress: processed is 10, confirmed is still 5, failed is 5
    expect(progressUpdates[1]).toEqual({
      processed: 10,
      confirmed: 5,
      failed: 5,
      indeterminate: 0,
      total: 10,
    });
  });

  it("identifies network timeouts as indeterminate outcomes rather than confirmed write failures", async () => {
    const records = makeRecords(5);
    (supabase.functions.invoke as any).mockImplementation(async () => {
      return {
        data: null,
        error: { message: "TypeError: Failed to fetch (network connection lost)" },
      };
    });

    const res = await syncRecords({ baseId: "appBase", tableId: "tbl1", records });

    expect(res.synced).toBe(0);
    expect(res.indeterminate).toBe(5);
    expect(res.indeterminateIds).toEqual(records.map((r) => r.id));
  });
});
