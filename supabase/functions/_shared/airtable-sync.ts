/**
 * Server-side allowlist for Airtable writes. The client sends only semantic
 * values (distance/cost/status/purpose); the server maps them to field IDs
 * taken from the caller's own saved mapping for the requested table.
 * Pure module so it can be unit-tested without network or Deno APIs.
 */
export type SemanticKey = "distance" | "cost" | "status" | "purpose";
const SEMANTIC_KEYS: SemanticKey[] = ["distance", "cost", "status", "purpose"];

export interface StoredMapping {
  table_id: string;
  distance_col_id: string;
  cost_col_id: string | null;
  status_col_id: string | null;
  purpose_col_id: string | null;
}

export type AllowedFields = Partial<Record<SemanticKey, string>>;

export interface SemanticSyncRecord {
  id: string;
  distance?: string;
  cost?: number;
  status?: string;
  purpose?: string;
}

export class SyncAuthorizationError extends Error {}

/**
 * Resolves the writable field IDs. Fails when the mapping is missing, belongs
 * to another table, or references fields not present in the live table schema.
 */
export function resolveAllowedFields(
  mapping: StoredMapping | null,
  tableId: string,
  tableFieldIds: Set<string>,
): AllowedFields {
  if (!mapping) throw new SyncAuthorizationError("No saved column mapping for this table.");
  if (mapping.table_id !== tableId) {
    throw new SyncAuthorizationError("Saved mapping does not belong to this table.");
  }
  const candidates: AllowedFields = {
    distance: mapping.distance_col_id,
    cost: mapping.cost_col_id ?? undefined,
    status: mapping.status_col_id ?? undefined,
    purpose: mapping.purpose_col_id ?? undefined,
  };
  const allowed: AllowedFields = {};
  for (const key of SEMANTIC_KEYS) {
    const fieldId = candidates[key];
    if (!fieldId) continue;
    if (!tableFieldIds.has(fieldId)) {
      throw new SyncAuthorizationError(`Mapped ${key} column is not part of this table.`);
    }
    allowed[key] = fieldId;
  }
  if (!allowed.distance) throw new SyncAuthorizationError("Distance column is not mapped.");
  return allowed;
}

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

/** Builds the Airtable PATCH payload; any key outside the allowlist is dropped. */
export function buildPatchRecords(
  records: unknown[],
  allowed: AllowedFields,
): Array<{ id: string; fields: Record<string, string | number> }> {
  const out: Array<{ id: string; fields: Record<string, string | number> }> = [];
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !RECORD_ID.test(r.id)) continue;
    const fields: Record<string, string | number> = {};
    for (const key of SEMANTIC_KEYS) {
      const fieldId = allowed[key];
      const value = r[key];
      if (!fieldId || value === undefined || value === null) continue;
      if (key === "cost") {
        if (typeof value === "number" && Number.isFinite(value)) fields[fieldId] = value;
      } else if (typeof value === "string" && value.length <= 2000) {
        fields[fieldId] = value;
      }
    }
    if (Object.keys(fields).length) out.push({ id: r.id, fields });
  }
  return out;
}
