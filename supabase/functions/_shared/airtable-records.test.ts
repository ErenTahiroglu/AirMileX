import { describe, expect, it } from "vitest";
import {
  AirtableInputError,
  AirtablePaginationError,
  PatchError,
  buildBlankFieldFormula,
  clampPreviewLimit,
  paginateAirtableRecords,
  projectMappedFields,
  syncWithBatching,
  isQuotaLimitError,
  type AirtableRecordItem,
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

  it("retries 429 when error is AirtablePaginationError", async () => {
    let call = 0;
    const r = await syncWithBatching(recs(2), async (b) => {
      if (call++ === 0) throw new AirtablePaginationError("Airtable 429: Too Many Requests", 429);
      return b.map((x) => x.id);
    }, noSleep);
    expect(r.synced).toBe(2);
  });
});

const generateRecords = (count: number, startId = 0): AirtableRecordItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `rec_${startId + i}`,
    fields: {
      "Start Address": `Address A ${startId + i}`,
      "End Address": `Address B ${startId + i}`,
      "Distance": "",
      "Internal Note": `Secret note ${startId + i}`,
    },
  }));

describe("AirMileX Phase 2A: Airtable Offset Pagination", () => {
  it("Requirement: 5-record preview remains unchanged", () => {
    expect(clampPreviewLimit(100)).toBe(5);
    expect(clampPreviewLimit(5)).toBe(5);
    expect(clampPreviewLimit(3)).toBe(3);
    expect(clampPreviewLimit(-1)).toBe(1);
    expect(clampPreviewLimit(null)).toBe(5);
  });

  it("Requirement: A single page with fewer than 100 records", async () => {
    const pageRecords = generateRecords(42);
    let fetchCount = 0;

    const result = await paginateAirtableRecords(
      async (offset) => {
        fetchCount++;
        expect(offset).toBeUndefined();
        return {
          records: pageRecords,
          offset: undefined, // No further pages
        };
      },
      { ...noSleep, maxRecords: 500 }
    );

    expect(fetchCount).toBe(1);
    expect(result.records.length).toBe(42);
    expect(result.total).toBe(42);
    expect(result.pageCount).toBe(1);
    expect(result.limitReached).toBe(false);
    expect(result.exhausted).toBe(true);
    expect(result.offset).toBeUndefined();
  });

  it("Requirement: Multiple pages totaling 250 records", async () => {
    const page1 = generateRecords(100, 0);
    const page2 = generateRecords(100, 100);
    const page3 = generateRecords(50, 200);
    const requestedOffsets: (string | undefined)[] = [];

    const result = await paginateAirtableRecords(
      async (offset) => {
        requestedOffsets.push(offset);
        if (!offset) {
          return { records: page1, offset: "itr_page_2" };
        }
        if (offset === "itr_page_2") {
          return { records: page2, offset: "itr_page_3" };
        }
        if (offset === "itr_page_3") {
          return { records: page3, offset: undefined };
        }
        throw new Error(`Unexpected offset: ${offset}`);
      },
      { ...noSleep, maxRecords: 500 }
    );

    expect(requestedOffsets).toEqual([undefined, "itr_page_2", "itr_page_3"]);
    expect(result.records.length).toBe(250);
    expect(result.total).toBe(250);
    expect(result.pageCount).toBe(3);
    expect(result.limitReached).toBe(false);
    expect(result.exhausted).toBe(true);
    expect(result.offset).toBeUndefined();
  });

  it("Requirement: Limit of 500 records stops safely when more records exist", async () => {
    // 6 pages of 100 records available in Airtable (600 total)
    let pagesCalled = 0;
    const result = await paginateAirtableRecords(
      async (offset) => {
        pagesCalled++;
        const pageIdx = offset ? parseInt(offset.replace("off_", ""), 10) : 0;
        return {
          records: generateRecords(100, pageIdx * 100),
          offset: `off_${pageIdx + 1}`, // Always indicates more records exist
        };
      },
      { ...noSleep, maxRecords: 500 }
    );

    // Should fetch exactly 5 pages of 100 to reach 500, then stop without calling page 6
    expect(pagesCalled).toBe(5);
    expect(result.records.length).toBe(500);
    expect(result.total).toBe(500);
    expect(result.pageCount).toBe(5);
    expect(result.limitReached).toBe(true);
    expect(result.exhausted).toBe(false);
    expect(result.offset).toBe("off_5"); // Preserves cursor for potential next page
  });

  it("Requirement: Truncates partially when custom limit cuts mid-page", async () => {
    let pagesCalled = 0;
    const result = await paginateAirtableRecords(
      async (offset) => {
        pagesCalled++;
        if (!offset) return { records: generateRecords(100, 0), offset: "off_1" };
        if (offset === "off_1") return { records: generateRecords(100, 100), offset: "off_2" };
        throw new Error("Should not be called");
      },
      { ...noSleep, maxRecords: 150 }
    );

    expect(pagesCalled).toBe(2);
    expect(result.records.length).toBe(150);
    expect(result.limitReached).toBe(true);
    expect(result.exhausted).toBe(false);
  });

  it("Requirement: Invalid or expired offset throws explicit error and rejects", async () => {
    let call = 0;
    await expect(
      paginateAirtableRecords(
        async (offset) => {
          call++;
          if (call === 1) {
            return { records: generateRecords(100, 0), offset: "expired_token_xyz" };
          }
          // Second page fails with 422 Invalid Offset from Airtable
          const err = new AirtablePaginationError("LIST_RECORDS_ITERATOR_NOT_AVAILABLE: The requested offset has expired", 422, false, true);
          throw err;
        },
        noSleep
      )
    ).rejects.toThrow("The requested offset has expired");
  });

  it("Requirement: HTTP 429 respects Retry-After cooldown and recovers", async () => {
    let attempts = 0;
    const sleptTimes: number[] = [];

    const result = await paginateAirtableRecords(
      async () => {
        attempts++;
        if (attempts === 1) {
          const err = new AirtablePaginationError("Airtable 429: Too many requests", 429);
          err.headers = { "retry-after": "2" } as any;
          throw err;
        }
        return { records: generateRecords(10), offset: undefined };
      },
      {
        maxRetries: 2,
        sleep: async (ms) => { sleptTimes.push(ms); },
      }
    );

    expect(attempts).toBe(2);
    expect(sleptTimes).toEqual([2000]); // 2 seconds from retry-after
    expect(result.records.length).toBe(10);
  });

  it("Requirement: HTTP 429 uses 30s default cooldown when Retry-After is omitted", async () => {
    let attempts = 0;
    const sleptTimes: number[] = [];

    const result = await paginateAirtableRecords(
      async () => {
        attempts++;
        if (attempts === 1) {
          throw new AirtablePaginationError("Airtable 429: Too many requests", 429);
        }
        return { records: generateRecords(5), offset: undefined };
      },
      {
        maxRetries: 2,
        defaultCooldownMs: 30000,
        sleep: async (ms) => { sleptTimes.push(ms); },
      }
    );

    expect(attempts).toBe(2);
    expect(sleptTimes).toEqual([30000]);
    expect(result.records.length).toBe(5);
  });

  it("Requirement: Monthly API quota exhaustion is not retried", async () => {
    let attempts = 0;
    const sleptTimes: number[] = [];

    await expect(
      paginateAirtableRecords(
        async () => {
          attempts++;
          // Airtable monthly quota limit error
          throw new AirtablePaginationError(
            "MONTHLY_APPROVED_USAGE_LIMIT_EXCEEDED: You have exceeded your monthly API request allowance",
            429,
            true // isQuotaExceeded
          );
        },
        {
          maxRetries: 3,
          sleep: async (ms) => { sleptTimes.push(ms); },
        }
      )
    ).rejects.toThrow("MONTHLY_APPROVED_USAGE_LIMIT_EXCEEDED");

    expect(attempts).toBe(1); // Never retried
    expect(sleptTimes.length).toBe(0);
  });

  it("Requirement: Partial retrieval failure never silently returns incomplete data", async () => {
    let call = 0;

    await expect(
      paginateAirtableRecords(
        async (offset) => {
          call++;
          if (call === 1) {
            return { records: generateRecords(100, 0), offset: "cursor_ok" };
          }
          throw new Error("Network connection dropped on page 2");
        },
        noSleep
      )
    ).rejects.toThrow("Network connection dropped on page 2");
  });

  it("Requirement: Field projection whitelists only mapped fields and preserves field names", () => {
    const rawRecords: AirtableRecordItem[] = [
      {
        id: "rec_1",
        fields: {
          "Start Address": "100 Main St",
          "End Address": "200 Market St",
          "Distance": "",
          "Trip Purpose": "Client Meeting",
          "Internal SSN": "000-00-0000",
          "Unmapped Secret": "confidential",
        },
      },
    ];

    const allowedFieldNames = new Set(["Start Address", "End Address", "Distance", "Trip Purpose"]);
    const projected = projectMappedFields(rawRecords, allowedFieldNames);

    expect(projected[0].id).toBe("rec_1");
    expect(projected[0].fields).toEqual({
      "Start Address": "100 Main St",
      "End Address": "200 Market St",
      "Distance": "",
      "Trip Purpose": "Client Meeting",
    });
    expect(projected[0].fields["Internal SSN"]).toBeUndefined();
    expect(projected[0].fields["Unmapped Secret"]).toBeUndefined();
  });

  it("Requirement: isQuotaLimitError detects PUBLIC_API_BILLING_LIMIT_EXCEEDED", () => {
    expect(isQuotaLimitError(429, "PUBLIC_API_BILLING_LIMIT_EXCEEDED: You have exceeded the monthly limit")).toBe(true);
    expect(isQuotaLimitError(429, "MONTHLY_APPROVED_USAGE_LIMIT_EXCEEDED")).toBe(true);
    expect(isQuotaLimitError(402, "Payment Required")).toBe(true);
    expect(isQuotaLimitError(429, "TOO_MANY_REQUESTS")).toBe(false);
  });

  it("Requirement: PageSize propagation allows 150-record retrieval to continue without skipping records", async () => {
    // 200 total records in simulated Airtable
    const totalRecords = generateRecords(200, 0);
    const requestedPageSizes: Array<number | undefined> = [];

    // Simulated Airtable API handler respecting pageSize
    const fakeAirtableFetch = async (offset?: string, pageSize?: number) => {
      requestedPageSizes.push(pageSize);
      const startIdx = offset ? parseInt(offset.replace("offset_", ""), 10) : 0;
      const size = pageSize ?? 100;
      const slice = totalRecords.slice(startIdx, startIdx + size);
      const nextIdx = startIdx + slice.length;
      const nextOffset = nextIdx < totalRecords.length ? `offset_${nextIdx}` : undefined;
      return {
        records: slice,
        offset: nextOffset,
      };
    };

    // First run: retrieves 150 records
    const run1 = await paginateAirtableRecords(fakeAirtableFetch, { maxRecords: 150, sleep: async () => {} });

    expect(run1.records.length).toBe(150);
    expect(run1.total).toBe(150);
    expect(run1.limitReached).toBe(true);
    expect(run1.exhausted).toBe(false);
    expect(run1.offset).toBe("offset_150");
    expect(run1.records[0].id).toBe("rec_0");
    expect(run1.records[149].id).toBe("rec_149");

    // Verify pageSizes requested: first page 100, second page 50 (never blindly requesting 100 on second page)
    expect(requestedPageSizes).toEqual([100, 50]);

    // Second run: continuation using the offset from run1, requesting up to 150 records
    const run2 = await paginateAirtableRecords(
      async (offset, pageSize) => fakeAirtableFetch(offset ?? run1.offset, pageSize),
      { maxRecords: 150, sleep: async () => {} }
    );

    // Remaining records from 150 to 199 (50 records)
    expect(run2.records.length).toBe(50);
    expect(run2.total).toBe(50);
    expect(run2.exhausted).toBe(true);
    expect(run2.limitReached).toBe(false);
    expect(run2.offset).toBeUndefined();
    // CRITICAL: First record of run2 is exactly rec_150, no records skipped!
    expect(run2.records[0].id).toBe("rec_150");
    expect(run2.records[49].id).toBe("rec_199");
  });
});

