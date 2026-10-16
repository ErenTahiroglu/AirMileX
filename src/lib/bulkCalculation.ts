import {
  calculateDistances,
  type AddressPair,
  type CalculateDistancesResponse,
  type DistanceResult,
} from "@/services/distance";

export interface BulkRecordInput {
  id: string;
  start: string;
  end: string;
}

export class InsufficientCreditsError extends Error {
  constructor(public required: number, public available: number) {
    super(
      `Insufficient credits: calculation requires ${required} credit(s), but only ${available} available.`
    );
    this.name = "InsufficientCreditsError";
  }
}

export interface CalculationProgress {
  processed: number;
  completed: number;
  failed: number;
  indeterminate: number;
  total: number;
  currentBatch: number;
  totalBatches: number;
}

export interface BulkCalculationOptions {
  batchSize?: number; // default: 5
  availableCredits: number;
  isCancelled?: () => boolean;
  onBatchComplete?: (
    batchResults: DistanceResult[],
    creditsRemaining?: number,
    refundError?: string
  ) => void;
  onProgress?: (progress: CalculationProgress) => void;
  calculateDistancesFn?: (
    pairs: AddressPair[],
    options?: { is_bulk?: boolean }
  ) => Promise<CalculateDistancesResponse>;
  fetchAuthoritativeCreditsFn?: () => Promise<number | null>;
}

export interface BulkCalculationSummary {
  total: number;
  ok: number;
  error: number;
  indeterminate: number;
  skippedEmpty: number;
}

export interface BulkCalculationResult {
  results: DistanceResult[];
  creditsRemaining?: number;
  refundErrors: string[];
  cancelled: boolean;
  summary: BulkCalculationSummary;
}

export const isNetworkTimeoutError = (msg: string): boolean =>
  /network|fetch|timeout|abort|502|503|504|load failed|connection/i.test(msg);

export const isConfigurationError = (msg: string): boolean =>
  /not configured|configuration|operator map service|no maps api key/i.test(msg);

export function isIndeterminateResult(result: DistanceResult): boolean {
  return (
    result.status === "error" &&
    (result.error_type === "indeterminate" ||
      (result.error || "").toLowerCase().includes("indeterminate"))
  );
}

/**
 * Partitions preview records into:
 * - okRecordIds: confirmed successful results (never re-run in normal continuation)
 * - indeterminateRecordIds: indeterminate network outcomes (require explicit confirmation to retry)
 * - remainingToCalculate: records that have not yet been dispatched or are neither ok nor indeterminate
 * - indeterminateRecords: records that ended in an indeterminate state
 */
export function partitionRecordsForContinuation<T extends { id: string }>(
  preview: T[],
  distances: DistanceResult[]
): {
  okRecordIds: Set<string>;
  indeterminateRecordIds: Set<string>;
  remainingToCalculate: T[];
  indeterminateRecords: T[];
} {
  const okRecordIds = new Set(
    distances.filter((d) => d.status === "ok").map((d) => d.record_id)
  );
  const indeterminateRecordIds = new Set(
    distances.filter(isIndeterminateResult).map((d) => d.record_id)
  );

  const remainingToCalculate = preview.filter(
    (r) => !okRecordIds.has(r.id) && !indeterminateRecordIds.has(r.id)
  );
  const indeterminateRecords = preview.filter((r) =>
    indeterminateRecordIds.has(r.id)
  );

  return {
    okRecordIds,
    indeterminateRecordIds,
    remainingToCalculate,
    indeterminateRecords,
  };
}

/**
 * Formats user-facing calculation notification without falsely claiming failed rows
 * were refunded unless confirmed by the server.
 */
export function formatCalculationNotification(
  summary: BulkCalculationSummary,
  refundErrors: string[]
): {
  title: string;
  description: string;
  variant: "default" | "destructive";
} {
  if (refundErrors.length > 0) {
    return {
      title: "Calculation completed with refund errors",
      description: `${summary.ok} succeeded, ${summary.error} failed, ${summary.indeterminate} indeterminate. Warning: automatic credit refund failed (${refundErrors.join("; ")}).`,
      variant: "destructive",
    };
  }

  const parts: string[] = [`${summary.ok} succeeded`];
  if (summary.error > 0) {
    parts.push(`${summary.error} failed (credits refunded)`);
  }
  if (summary.indeterminate > 0) {
    parts.push(`${summary.indeterminate} indeterminate (not refunded)`);
  }

  return {
    title: "Calculation completed",
    description: parts.join(", ") + ".",
    variant: "default",
  };
}

/**
 * Validates and separates records into valid address pairs and invalid pairs.
 * Invalid pairs are marked with error status immediately without consuming credits.
 */
export function filterValidAddressPairs(records: BulkRecordInput[]): {
  valid: BulkRecordInput[];
  invalidResults: DistanceResult[];
} {
  const valid: BulkRecordInput[] = [];
  const invalidResults: DistanceResult[] = [];

  for (const r of records) {
    const startValid = Boolean(r.start && r.start.trim().length > 0);
    const endValid = Boolean(r.end && r.end.trim().length > 0);

    if (startValid && endValid) {
      valid.push({
        id: r.id,
        start: r.start.trim(),
        end: r.end.trim(),
      });
    } else {
      invalidResults.push({
        record_id: r.id,
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: "Missing start or destination address",
        error_type: "not_found",
      });
    }
  }

  return { valid, invalidResults };
}


/**
 * Orchestrates batched bulk mileage calculation:
 * - Starting batch size of 5 records (configurable).
 * - Pre-validates address pairs; empty/invalid pairs never cost credits.
 * - Enforces available credit sufficiency before starting (never partial jobs).
 * - Preserves completed results per batch via onBatchComplete.
 * - Stops scheduling NEW batches upon cancellation without aborting in-flight requests.
 * - Marks network timeouts/drops as indeterminate and never auto-retries them.
 */
export async function executeBulkDistanceCalculation(
  records: BulkRecordInput[],
  options: BulkCalculationOptions
): Promise<BulkCalculationResult> {
  const {
    batchSize = 5,
    availableCredits,
    isCancelled = () => false,
    onBatchComplete,
    onProgress,
    calculateDistancesFn = calculateDistances,
    fetchAuthoritativeCreditsFn,
  } = options;


  // 1. Separate valid address pairs from empty/invalid pairs
  const { valid, invalidResults } = filterValidAddressPairs(records);

  // 2. Validate credits before starting
  if (availableCredits < valid.length) {
    throw new InsufficientCreditsError(valid.length, availableCredits);
  }

  // Map to preserve original order
  const resultMap = new Map<string, DistanceResult>();
  for (const inv of invalidResults) {
    resultMap.set(inv.record_id, inv);
  }

  const refundErrors: string[] = [];
  let latestCreditsRemaining: number | undefined;
  let cancelled = false;

  const totalBatches = Math.ceil(valid.length / batchSize);
  let processedValidCount = 0;
  let okCount = 0;
  let errorCount = invalidResults.length;
  let indeterminateCount = 0;

  for (let batchIndex = 0; batchIndex < valid.length; batchIndex += batchSize) {
    // Check cancellation BEFORE scheduling a new batch
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    const currentBatchNum = Math.floor(batchIndex / batchSize) + 1;
    const batchRecords = valid.slice(batchIndex, batchIndex + batchSize);
    const pairs: AddressPair[] = batchRecords.map((r) => ({
      record_id: r.id,
      start: r.start,
      end: r.end,
    }));

    try {
      const response = await calculateDistancesFn(pairs, { is_bulk: true });
      if (typeof response.credits_remaining === "number") {
        latestCreditsRemaining = response.credits_remaining;
      }
      if (response.refund_error) {
        refundErrors.push(response.refund_error);
      }

      const batchResults = response.results ?? [];
      for (const res of batchResults) {
        resultMap.set(res.record_id, res);
        if (res.status === "ok") {
          okCount++;
        } else {
          errorCount++;
        }
      }

      processedValidCount += batchRecords.length;
      onBatchComplete?.(batchResults, latestCreditsRemaining, response.refund_error);
    } catch (err) {
      const errMsg = (err as Error).message || "Unknown calculation error";
      const isIndet = isNetworkTimeoutError(errMsg);
      const isConfig = isConfigurationError(errMsg);

      if (/refund/i.test(errMsg)) {
        refundErrors.push(errMsg);
      }

      const fallbackResults: DistanceResult[] = batchRecords.map((r) => ({
        record_id: r.id,
        distance_km: 0,
        distance_mi: 0,
        status: "error",
        error: isIndet
          ? `Indeterminate network outcome: ${errMsg}`
          : errMsg,
        error_type: isIndet ? "indeterminate" : isConfig ? "provider" : "network",
      }));

      for (const res of fallbackResults) {
        resultMap.set(res.record_id, res);
      }

      if (isIndet) {
        indeterminateCount += batchRecords.length;
      } else {
        errorCount += batchRecords.length;
      }

      processedValidCount += batchRecords.length;
      onBatchComplete?.(
        fallbackResults,
        latestCreditsRemaining,
        /refund/i.test(errMsg) ? errMsg : undefined
      );

      // Stop on fatal authentication, 402, or provider configuration error
      if (
        errMsg.includes("402") ||
        errMsg.includes("Insufficient credits") ||
        errMsg.includes("401") ||
        isConfig
      ) {
        break;
      }
    }

    onProgress?.({
      processed: processedValidCount + invalidResults.length,
      completed: okCount,
      failed: errorCount,
      indeterminate: indeterminateCount,
      total: records.length,
      currentBatch: currentBatchNum,
      totalBatches,
    });
  }

  // If latestCreditsRemaining is still undefined OR refund errors occurred, fetch authoritative balance if provided
  if (
    (typeof latestCreditsRemaining !== "number" || refundErrors.length > 0) &&
    fetchAuthoritativeCreditsFn
  ) {
    try {
      const fetched = await fetchAuthoritativeCreditsFn();
      if (typeof fetched === "number") {
        latestCreditsRemaining = fetched;
      }
    } catch {
      // Ignore background fetch error
    }
  }

  // Reassemble in original record order
  const orderedResults: DistanceResult[] = records
    .map((r) => resultMap.get(r.id))
    .filter(Boolean) as DistanceResult[];


  return {
    results: orderedResults,
    creditsRemaining: latestCreditsRemaining,
    refundErrors,
    cancelled,
    summary: {
      total: records.length,
      ok: okCount,
      error: errorCount,
      indeterminate: indeterminateCount,
      skippedEmpty: invalidResults.length,
    },
  };
}
