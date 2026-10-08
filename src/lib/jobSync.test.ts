import { describe, it, expect } from "vitest";
import { buildSyncRecords } from "./jobSync";
import type { DistanceResult } from "@/services/distance";

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
});
