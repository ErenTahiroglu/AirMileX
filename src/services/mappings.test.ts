import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  calculateReimbursement,
  DEFAULT_RATE_PER_MILE,
  getMapping,
  upsertMapping,
  type MappingInput,
} from "./mappings";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: vi.fn(),
    },
  };
});

describe("mappings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateReimbursement", () => {
    it("calculates reimbursement for miles at default IRS rate", () => {
      const amount = calculateReimbursement(10, DEFAULT_RATE_PER_MILE, "mi");
      expect(amount).toBeCloseTo(7.6, 2);
    });

    it("calculates reimbursement for kilometres converted from miles", () => {
      // 10 miles = 16.09344 km
      const amount = calculateReimbursement(10, 0.5, "km");
      expect(amount).toBeCloseTo(16.09344 * 0.5, 4);
    });
  });

  describe("upsertMapping validation & persistence", () => {
    it("rejects mapping input missing required user_id or table_id", async () => {
      await expect(
        upsertMapping({
          user_id: "",
          table_id: "tbl1",
          start_col_id: "fldStart",
          end_col_id: "fldEnd",
          distance_col_id: "fldDist",
        } as MappingInput)
      ).rejects.toThrow("Missing user_id or table_id for mapping.");

      await expect(
        upsertMapping({
          user_id: "usr1",
          table_id: "",
          start_col_id: "fldStart",
          end_col_id: "fldEnd",
          distance_col_id: "fldDist",
        } as MappingInput)
      ).rejects.toThrow("Missing user_id or table_id for mapping.");
    });

    it("rejects mapping missing required start, end, or distance columns", async () => {
      await expect(
        upsertMapping({
          user_id: "usr1",
          table_id: "tbl1",
          start_col_id: "",
          end_col_id: "fldEnd",
          distance_col_id: "fldDist",
        })
      ).rejects.toThrow("Start, End, and Distance columns are required.");

      await expect(
        upsertMapping({
          user_id: "usr1",
          table_id: "tbl1",
          start_col_id: "fldStart",
          end_col_id: "",
          distance_col_id: "fldDist",
        })
      ).rejects.toThrow("Start, End, and Distance columns are required.");

      await expect(
        upsertMapping({
          user_id: "usr1",
          table_id: "tbl1",
          start_col_id: "fldStart",
          end_col_id: "fldEnd",
          distance_col_id: "",
        })
      ).rejects.toThrow("Start, End, and Distance columns are required.");
    });

    it("successfully upserts and returns saved mapping with all optional fields", async () => {
      const mockResult = {
        id: "map-123",
        user_id: "usr1",
        table_id: "tbl1",
        start_col_id: "fldStart",
        end_col_id: "fldEnd",
        distance_col_id: "fldDist",
        cost_col_id: "fldCost",
        status_col_id: "fldStatus",
        notes_col_id: "fldNotes",
        purpose_col_id: "fldPurpose",
        rate_per_unit: 0.76,
        rate_unit: "mi",
      };

      const singleMock = vi.fn().mockResolvedValue({ data: mockResult, error: null });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const upsertMock = vi.fn().mockReturnValue({ select: selectMock });
      (supabase.from as any).mockReturnValue({ upsert: upsertMock } as unknown as ReturnType<typeof supabase.from>);

      const res = await upsertMapping({
        user_id: "usr1",
        table_id: "tbl1",
        start_col_id: "fldStart",
        end_col_id: "fldEnd",
        distance_col_id: "fldDist",
        cost_col_id: "fldCost",
        status_col_id: "fldStatus",
        notes_col_id: "fldNotes",
        purpose_col_id: "fldPurpose",
        rate_per_unit: 0.76,
        rate_unit: "mi",
      });

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "usr1",
          table_id: "tbl1",
          start_col_id: "fldStart",
          end_col_id: "fldEnd",
          distance_col_id: "fldDist",
          notes_col_id: "fldNotes",
          purpose_col_id: "fldPurpose",
        }),
        { onConflict: "user_id,table_id" }
      );
      expect(res).toEqual(mockResult);
    });

    it("surfaces database errors when upsert fails", async () => {
      const singleMock = vi.fn().mockResolvedValue({ data: null, error: new Error("DB constraint violation") });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const upsertMock = vi.fn().mockReturnValue({ select: selectMock });
      (supabase.from as any).mockReturnValue({ upsert: upsertMock } as unknown as ReturnType<typeof supabase.from>);

      await expect(
        upsertMapping({
          user_id: "usr1",
          table_id: "tbl1",
          start_col_id: "fldStart",
          end_col_id: "fldEnd",
          distance_col_id: "fldDist",
        })
      ).rejects.toThrow("DB constraint violation");
    });
  });

  describe("getMapping table scoping", () => {
    it("queries strictly for the designated user_id and table_id", async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({
        data: {
          id: "m1",
          user_id: "usrA",
          table_id: "tblTarget",
          start_col_id: "fld1",
          end_col_id: "fld2",
          distance_col_id: "fld3",
          cost_col_id: null,
          status_col_id: null,
          notes_col_id: "fldNotes",
          purpose_col_id: "fldPurpose",
          rate_per_unit: 0.76,
          rate_unit: "mi",
        },
        error: null,
      });
      const eqTableMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const eqUserMock = vi.fn().mockReturnValue({ eq: eqTableMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      (supabase.from as any).mockReturnValue({ select: selectMock } as unknown as ReturnType<typeof supabase.from>);

      const result = await getMapping("usrA", "tblTarget");
      expect(selectMock).toHaveBeenCalledWith("*");
      expect(eqUserMock).toHaveBeenCalledWith("user_id", "usrA");
      expect(eqTableMock).toHaveBeenCalledWith("table_id", "tblTarget");
      expect(result?.notes_col_id).toBe("fldNotes");
      expect(result?.purpose_col_id).toBe("fldPurpose");
    });

    it("returns null when no mapping exists for the table", async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const eqTableMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const eqUserMock = vi.fn().mockReturnValue({ eq: eqTableMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      (supabase.from as any).mockReturnValue({ select: selectMock } as unknown as ReturnType<typeof supabase.from>);

      const result = await getMapping("usrA", "tblNonExistent");
      expect(result).toBeNull();
    });
  });
});
