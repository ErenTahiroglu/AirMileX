import { describe, expect, it } from "vitest";
import {
  AirtableInputError,
  PatchError,
  buildBlankFieldFormula,
  clampPreviewLimit,
  syncWithBatching,
  type PatchRecord,
} from "./airtable-records.ts";

const fields = [
  { id: "fldDist", name: "Distance (mi)" },
  { id: "fldQuote", name: `Driver's "km"` },
  { id: "fldBrace", name: "Bad {name}" },
  { id: "fldNl", name: "Line\nbreak" },
];

describe("blank distance filter", () => {
  it("uses the verified field name, not the ID", () => {
    expect(buildBlankFieldFormula("fldDist", fields)).toBe("{Distance (mi)}=BLANK()");
  });
  it("keeps quotes and spaces intact", () => {
    expect(buildBlankFieldFormula("fldQuote", fields)).toBe(`{Driver's "km"}=BLANK()`);
  });
  it("rejects unknown field IDs", () => {
    expect(() => buildBlankFieldFormula("fldOther", fields)).toThrow(AirtableInputError);
  });
  it("rejects names with braces or control characters", () => {
    expect(() => buildBlankFieldFormula("fldBrace", fields)).toThrow(AirtableInputError);
    expect(() => buildBlankFieldFormula("fldNl", fields)).toThrow(AirtableInputError);
  });
  it("caps preview at 5 records", () => {
    expect(clampPreviewLimit(50)).toBe(5);
    expect(clampPreviewLimit(undefined)).toBe(5);
    expect(clampPreviewLimit(2)).toBe(2);
  });
});

const recs = (n: number): PatchRecord[] =>
  Array.from({ length: n }, (_, i) => ({ id: `rec${i}`, fields: { f: i } }));
const noSleep = { sleep: async () => {} };

describe("batched sync outcomes", () => {
  it("reports full success from confirmed IDs", async () => {
    const r = await syncWithBatching(recs(12), async (b) => b.map((x) => x.id), noSleep);
    expect(r.synced).toBe(12);
    expect(r.failed).toBe(0);
    expect(r.failedIds).toEqual([]);
  });

  it("reports total failure", async () => {
    const r = await syncWithBatching(recs(3), async () => { throw new PatchError("Airtable 422", 422); }, noSleep);
    expect(r.synced).toBe(0);
    expect(r.failedIds).toEqual(["rec0", "rec1", "rec2"]);
  });

  it("tracks a partially failed run per batch", async () => {
    let call = 0;
    const r = await syncWithBatching(recs(15), async (b) => {
      call++;
      if (call === 2) throw new PatchError("Airtable 500", 500);
      return b.map((x) => x.id);
    }, noSleep);
    expect(r.synced).toBe(10);
    expect(r.failed).toBe(5);
    expect(r.failedIds).toEqual(["rec10", "rec11", "rec12", "rec13", "rec14"]);
  });

  it("counts unconfirmed records as failed", async () => {
    const r = await syncWithBatching(recs(3), async () => ["rec0"], noSleep);
    expect(r.succeededIds).toEqual(["rec0"]);
    expect(r.failedIds).toEqual(["rec1", "rec2"]);
  });

  it("retries 429 then succeeds", async () => {
    let call = 0;
    const r = await syncWithBatching(recs(2), async (b) => {
      if (call++ === 0) throw new PatchError("Airtable 429", 429);
      return b.map((x) => x.id);
    }, noSleep);
    expect(r.synced).toBe(2);
  });
});
