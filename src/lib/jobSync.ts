import type { DistanceResult } from "@/services/distance";
import { calculateReimbursement, type RateUnit } from "@/services/mappings";

export const STATUS_OK = "Hesaplandı";
export const STATUS_NOT_FOUND = "Adres Bulunamadı";

/** Which optional columns are mapped; the server resolves actual field IDs. */
export interface SyncColumnFlags {
  cost: boolean;
  status: boolean;
  purpose: boolean;
}

/** Semantic sync record: the server maps these keys to the user's saved columns. */
export interface JobSyncRecord {
  id: string;
  distance?: string;
  cost?: number;
  status?: string;
  purpose?: string;
}

/**
 * Builds the semantic sync payload: successful rows get distance, amount,
 * status and purpose in one update; failed rows only get the status marker.
 */
export const buildSyncRecords = (
  results: DistanceResult[],
  cols: SyncColumnFlags,
  ratePerUnit: number,
  rateUnit: RateUnit,
): JobSyncRecord[] => {
  const records: JobSyncRecord[] = [];
  for (const d of results) {
    if (d.status === "ok") {
      const r: JobSyncRecord = { id: d.record_id, distance: `${d.distance_mi.toFixed(2)} mi` };
      if (cols.cost) r.cost = Number(calculateReimbursement(d.distance_mi, ratePerUnit, rateUnit).toFixed(2));
      if (cols.status) r.status = STATUS_OK;
      if (cols.purpose && d.purposeText) r.purpose = d.purposeText;
      records.push(r);
    } else if (cols.status) {
      records.push({ id: d.record_id, status: STATUS_NOT_FOUND });
    }
  }
  return records;
};
