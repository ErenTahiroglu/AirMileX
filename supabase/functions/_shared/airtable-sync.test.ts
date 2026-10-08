import { describe, expect, it } from "vitest";
import { buildPatchRecords, resolveAllowedFields, SyncAuthorizationError } from "./airtable-sync.ts";

const mapping = {
  table_id: "tblA",
  distance_col_id: "fldDist",
  cost_col_id: "fldCost",
  status_col_id: "fldStatus",
  purpose_col_id: "fldPurpose",
};
const schema = new Set(["fldDist", "fldCost", "fldStatus", "fldPurpose", "fldSecret"]);
const rec = "rec12345678901234";

describe("airtable sync allowlist", () => {
  it("writes permitted mapped fields", () => {
    const allowed = resolveAllowedFields(mapping, "tblA", schema);
    const out = buildPatchRecords(
      [{ id: rec, distance: "10.00 mi", cost: 7.6, status: "Hesaplandı", purpose: "Client meeting" }],
      allowed,
    );
    expect(out).toEqual([
      { id: rec, fields: { fldDist: "10.00 mi", fldCost: 7.6, fldStatus: "Hesaplandı", fldPurpose: "Client meeting" } },
    ]);
  });

  it("removes an extra attacker-selected field", () => {
    const allowed = resolveAllowedFields(mapping, "tblA", schema);
    const out = buildPatchRecords(
      [{ id: rec, distance: "1 mi", fldSecret: "pwned", fields: { fldSecret: "pwned" } }],
      allowed,
    );
    expect(out).toEqual([{ id: rec, fields: { fldDist: "1 mi" } }]);
  });

  it("rejects another table's saved mapping", () => {
    expect(() => resolveAllowedFields(mapping, "tblB", schema)).toThrow(SyncAuthorizationError);
  });

  it("rejects mapped field IDs that are not in the requested table", () => {
    expect(() => resolveAllowedFields(mapping, "tblA", new Set(["fldDist"]))).toThrow(SyncAuthorizationError);
  });

  it("missing mapping cannot become an unrestricted write", () => {
    expect(() => resolveAllowedFields(null, "tblA", schema)).toThrow(SyncAuthorizationError);
  });
});
