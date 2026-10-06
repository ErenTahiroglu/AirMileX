import { describe, it, expect } from "vitest";
import { buildSyncRecords } from "./jobSync";
import type { DistanceResult } from "@/services/distance";

const ok: DistanceResult = { record_id: "rec1", distance_km: 16.09, distance_mi: 10, status: "ok", purposeText: "Client meeting" };
const bad: DistanceResult = { record_id: "rec2", distance_km: 0, distance_mi: 0, status: "error", purposeText: "x" };
const names = { distance: "Distance", cost: "Amount", status: "Status", purpose: "Purpose" };

describe("buildSyncRecords", () => {
  it("writes distance, amount, status and purpose for successful rows in one update", () => {
    const [r] = buildSyncRecords([ok], names, 0.76, "mi");
    expect(r).toEqual({ id: "rec1", fields: { Distance: "10.00 mi", Amount: 7.6, Status: "Hesaplandı", Purpose: "Client meeting" } });
  });

  it("marks failed rows only with 'Adres Bulunamadı'", () => {
    const [r] = buildSyncRecords([bad], names, 0.76, "mi");
    expect(r).toEqual({ id: "rec2", fields: { Status: "Adres Bulunamadı" } });
  });

  it("skips failed rows when no status column is mapped", () => {
    expect(buildSyncRecords([bad], { ...names, status: null }, 0.76, "mi")).toEqual([]);
  });

  it("omits purpose when no purpose column is mapped", () => {
    const [r] = buildSyncRecords([ok], { ...names, purpose: null }, 0.76, "mi");
    expect(r.fields.Purpose).toBeUndefined();
  });
});
