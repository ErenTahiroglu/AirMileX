import { supabase } from "@/integrations/supabase/client";

export type RateUnit = "mi" | "km";

/** IRS standard mileage rate for the second half of 2026. */
export const DEFAULT_RATE_PER_MILE = 0.76;

export interface SavedMapping {
  id: string;
  user_id: string;
  table_id: string;
  start_col_id: string;
  end_col_id: string;
  distance_col_id: string;
  cost_col_id: string | null;
  status_col_id: string | null;
  notes_col_id: string | null;
  purpose_col_id: string | null;
  rate_per_unit: number;
  rate_unit: RateUnit;
}

export interface MappingInput {
  user_id: string;
  table_id: string;
  start_col_id: string;
  end_col_id: string;
  distance_col_id: string;
  cost_col_id?: string | null;
  status_col_id?: string | null;
  notes_col_id?: string | null;
  purpose_col_id?: string | null;
  rate_per_unit?: number;
  rate_unit?: RateUnit;
}

export const getMapping = async (userId: string, tableId: string): Promise<SavedMapping | null> => {
  const { data, error } = await supabase
    .from("saved_mappings")
    .select("*")
    .eq("user_id", userId)
    .eq("table_id", tableId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    cost_col_id: data.cost_col_id ?? null,
    status_col_id: data.status_col_id ?? null,
    notes_col_id: data.notes_col_id ?? null,
    purpose_col_id: data.purpose_col_id ?? null,
    rate_per_unit: Number(data.rate_per_unit ?? DEFAULT_RATE_PER_MILE),
    rate_unit: (data.rate_unit ?? "mi") as RateUnit,
  } as SavedMapping;
};

export const upsertMapping = async (mapping: MappingInput): Promise<SavedMapping> => {
  if (!mapping.user_id || !mapping.table_id) {
    throw new Error("Missing user_id or table_id for mapping.");
  }
  if (!mapping.start_col_id || !mapping.end_col_id || !mapping.distance_col_id) {
    throw new Error("Start, End, and Distance columns are required.");
  }

  const payload = {
    user_id: mapping.user_id,
    table_id: mapping.table_id,
    start_col_id: mapping.start_col_id,
    end_col_id: mapping.end_col_id,
    distance_col_id: mapping.distance_col_id,
    cost_col_id: mapping.cost_col_id ?? null,
    status_col_id: mapping.status_col_id ?? null,
    notes_col_id: mapping.notes_col_id ?? null,
    purpose_col_id: mapping.purpose_col_id ?? null,
    rate_per_unit: mapping.rate_per_unit ?? DEFAULT_RATE_PER_MILE,
    rate_unit: mapping.rate_unit ?? "mi",
  };

  const { data, error } = await supabase
    .from("saved_mappings")
    .upsert(payload, { onConflict: "user_id,table_id" })
    .select()
    .single();

  if (error) throw error;
  return {
    ...data,
    cost_col_id: data.cost_col_id ?? null,
    status_col_id: data.status_col_id ?? null,
    notes_col_id: data.notes_col_id ?? null,
    purpose_col_id: data.purpose_col_id ?? null,
    rate_per_unit: Number(data.rate_per_unit ?? DEFAULT_RATE_PER_MILE),
    rate_unit: (data.rate_unit ?? "mi") as RateUnit,
  } as SavedMapping;
};

/** Reimbursement amount for a trip, based on the configured rate and unit. */
export const calculateReimbursement = (
  distanceMi: number,
  ratePerUnit: number,
  unit: RateUnit
): number => {
  const distance = unit === "km" ? distanceMi * 1.609344 : distanceMi;
  return distance * ratePerUnit;
};

export type MappingStatus = "idle" | "loading" | "saving" | "saved" | "error";

/**
 * Coordinates mapping persistence with latest-user-intent-wins semantics.
 * Serializes writes, avoids stale out-of-order completions, and protects against
 * cross-table contamination during rapid table switches.
 */
export class MappingCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private latestSeq = 0;
  private pendingPayload: { tableId: string; input: MappingInput; seq: number } | null = null;
  private currentTableId: string | null = null;
  private statusCallback?: (status: MappingStatus, err?: string | null) => void;
  private upsertFn: (input: MappingInput) => Promise<SavedMapping>;

  constructor(
    upsertFn: (input: MappingInput) => Promise<SavedMapping> = upsertMapping,
    onStatusChange?: (status: MappingStatus, err?: string | null) => void
  ) {
    this.upsertFn = upsertFn;
    this.statusCallback = onStatusChange;
  }

  setActiveTable(tableId: string | null) {
    this.currentTableId = tableId;
    if (this.pendingPayload && this.pendingPayload.tableId !== tableId) {
      this.pendingPayload = null;
    }
  }

  getActiveTable(): string | null {
    return this.currentTableId;
  }

  scheduleSave(tableId: string, input: MappingInput): Promise<SavedMapping | null> {
    const seq = ++this.latestSeq;
    this.pendingPayload = { tableId, input, seq };
    this.statusCallback?.("saving", null);

    return new Promise((resolve, reject) => {
      this.queue = this.queue.then(async () => {
        // If superseded by a newer save or table changed away
        if (!this.pendingPayload || this.pendingPayload.seq !== seq || this.currentTableId !== tableId) {
          resolve(null);
          return;
        }

        const toSave = this.pendingPayload.input;
        try {
          const result = await this.upsertFn(toSave);
          // Check again if superseded while network call was in flight
          if (this.pendingPayload?.seq === seq && this.currentTableId === tableId) {
            this.statusCallback?.("saved", null);
            resolve(result);
          } else {
            resolve(null);
          }
        } catch (err) {
          if (this.pendingPayload?.seq === seq && this.currentTableId === tableId) {
            const msg = (err as Error).message || "Failed to save mapping";
            this.statusCallback?.("error", msg);
            reject(err);
          } else {
            resolve(null);
          }
        }
      });
    });
  }

  async waitForLatest(): Promise<void> {
    await this.queue;
  }
}

