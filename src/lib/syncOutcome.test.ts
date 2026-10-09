import { describe, expect, it } from "vitest";
import { aggregateSync, syncOutcomeKind } from "./syncOutcome";

describe("sync outcome", () => {
  it("full success counts only confirmed IDs", () => {
    const r = aggregateSync([{ ids: ["a", "b"], result: { succeededIds: ["a", "b"] } }]);
    expect(r.synced).toBe(2);
    expect(syncOutcomeKind(r)).toBe("success");
  });

  it("a failed request marks its batch failed and keeps others", () => {
    const r = aggregateSync([
      { ids: ["a", "b"], result: { succeededIds: ["a", "b"] } },
      { ids: ["c"], error: "network down" },
    ]);
    expect(r.succeededIds).toEqual(["a", "b"]);
    expect(r.failedIds).toEqual(["c"]);
    expect(syncOutcomeKind(r)).toBe("partial");
  });

  it("unconfirmed IDs are failed, not counted as written", () => {
    const r = aggregateSync([{ ids: ["a", "b"], result: { synced: 2, succeededIds: ["a"] } }]);
    expect(r.synced).toBe(1);
    expect(r.failedIds).toEqual(["b"]);
  });

  it("total failure", () => {
    const r = aggregateSync([{ ids: ["a"], error: "x" }]);
    expect(syncOutcomeKind(r)).toBe("failure");
  });
});
