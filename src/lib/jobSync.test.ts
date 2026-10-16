import { describe, it, expect, vi } from "vitest";
import { buildSyncRecords } from "./jobSync";
import type { DistanceResult } from "@/services/distance";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getSession: vi.fn() },
  },
}));

const ok: DistanceResult = { record_id: "rec1", distance_km: 16.09, distance_mi: 10, status: "ok", purposeText: "Client meeting" };
const bad: DistanceResult = { record_id: "rec2", distance_km: 0, distance_mi: 0, status: "error", purposeText: "x" };
const cols = { cost: true, status: true, purpose: true };

describe("buildSyncRecords", () => {
  it("writes distance, amount, status and purpose for successful rows in one update", () => {
    const [r] = buildSyncRecords([ok], cols, 0.76, "mi");
    expect(r).toEqual({ id: "rec1", distance: "10.00 mi", cost: 7.6, status: "Hesaplandı", purpose: "Client meeting" });
  });

  it("marks failed rows only with 'Adres Bulunamadı'", () => {
    const [r] = buildSyncRecords([bad], cols, 0.76, "mi");
    expect(r).toEqual({ id: "rec2", status: "Adres Bulunamadı" });
  });

  it("skips failed rows when no status column is mapped", () => {
    expect(buildSyncRecords([bad], { ...cols, status: false }, 0.76, "mi")).toEqual([]);
  });

  it("omits purpose when no purpose column is mapped", () => {
    const [r] = buildSyncRecords([ok], { ...cols, purpose: false }, 0.76, "mi");
    expect(r.purpose).toBeUndefined();
  });

  describe("Task 2: Network, provider, and indeterminate failure exclusion", () => {
    it("regression test: network timeout cannot produce an Airtable 'Adres Bulunamadı' update and is excluded from sync", () => {
      const networkTimeoutResult: DistanceResult = {
        record_id: "rec_timeout",
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Network timeout: request exceeded 10000ms",
        error_type: "indeterminate",
      };

      const syncRecords = buildSyncRecords([networkTimeoutResult], cols, 0.76, "mi");
      expect(syncRecords).toHaveLength(0);
      expect(syncRecords.find((r) => r.status === "Adres Bulunamadı")).toBeUndefined();
    });

    it("regression test: provider 5xx and rate limits cannot produce 'Adres Bulunamadı' update", () => {
      const providerErrorResult: DistanceResult = {
        record_id: "rec_500",
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Provider 500 internal server error",
        error_type: "provider",
      };

      const syncRecords = buildSyncRecords([providerErrorResult], cols, 0.76, "mi");
      expect(syncRecords).toHaveLength(0);
    });

    it("preserves genuine address-not-found rows with 'Adres Bulunamadı'", () => {
      const genuineNotFound: DistanceResult = {
        record_id: "rec_not_found",
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Address not found: 123 Nonexistent Street Nowhere",
        error_type: "not_found",
      };

      const syncRecords = buildSyncRecords([genuineNotFound], cols, 0.76, "mi");
      expect(syncRecords).toEqual([
        { id: "rec_not_found", status: "Adres Bulunamadı" },
      ]);
    });
  });
});

