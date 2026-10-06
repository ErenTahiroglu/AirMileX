import type { DistanceResult } from "@/services/distance";
import { calculateReimbursement, type RateUnit } from "@/services/mappings";

export const STATUS_OK = "Hesaplandı";
export const STATUS_NOT_FOUND = "Adres Bulunamadı";

export interface SyncFieldNames {
  distance: string;
  cost: string | null;
  status: string | null;
  purpose: string | null;
}

export interface JobSyncRecord {
  id: string;
  fields: Record<string, string | number>;
}

/**
 * Builds the Airtable update payload: successful rows get distance, amount,
 * status and purpose in one update; failed rows only get the status marker.
 */
export const buildSyncRecords = (
  results: DistanceResult[],
  names: SyncFieldNames,
  ratePerUnit: number,
  rateUnit: RateUnit,
): JobSyncRecord[] => {
  const records: JobSyncRecord[] = [];
  for (const d of results) {
    if (d.status === "ok") {
      const values: Record<string, string | number> = {
        [names.distance]: `${d.distance_mi.toFixed(2)} mi`,
      };
      if (names.cost) {
        values[names.cost] = Number(calculateReimbursement(d.distance_mi, ratePerUnit, rateUnit).toFixed(2));
      }
      if (names.status) values[names.status] = STATUS_OK;
      if (names.purpose && d.purposeText) values[names.purpose] = d.purposeText;
      records.push({ id: d.record_id, fields: values });
    } else if (names.status) {
      records.push({ id: d.record_id, fields: { [names.status]: STATUS_NOT_FOUND } });
    }
  }
  return records;
};
