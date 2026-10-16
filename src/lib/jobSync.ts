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
 * Distinguishes genuine address-not-found outcomes (e.g. invalid address,
 * geocoder zero results) from network timeouts, provider 5xx, or indeterminate outcomes.
 */
export function isAddressNotFoundError(result: DistanceResult): boolean {
  if (result.status === "ok") return false;

  // Explicit non-address failure types
  if (
    result.error_type === "indeterminate" ||
    result.error_type === "network" ||
    result.error_type === "provider"
  ) {
    return false;
  }

  // Explicit address not found type
  if (result.error_type === "not_found") {
    return true;
  }

  const err = (result.error || "").toLowerCase();

  // If the error message indicates network, timeout, provider 5xx, rate limits, or indeterminate
  if (
    err.includes("indeterminate") ||
    err.includes("network") ||
    err.includes("timeout") ||
    err.includes("abort") ||
    err.includes("unreachable") ||
    err.includes("connection") ||
    err.includes("500") ||
    err.includes("502") ||
    err.includes("503") ||
    err.includes("504") ||
    err.includes("429") ||
    err.includes("quota") ||
    err.includes("provider") ||
    err.includes("fetch failed") ||
    err.includes("load failed")
  ) {
    return false;
  }

  // Otherwise, genuine calculation failure without network/provider trouble
  return true;
}

/**
 * Builds the semantic sync payload: successful rows get distance, amount,
 * status and purpose in one update; genuine address-not-found rows only get the status marker.
 * Network/provider/indeterminate failures are strictly excluded from sync.
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
    } else if (cols.status && isAddressNotFoundError(d)) {
      records.push({ id: d.record_id, status: STATUS_NOT_FOUND });
    }
  }
  return records;
};

