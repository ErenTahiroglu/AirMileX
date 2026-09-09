/**
 * Simple batching rate-limiter.
 * Splits work into fixed-size batches and waits between them so that
 * upstream APIs (e.g. Airtable) do not return HTTP 429.
 */

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const chunk = <T>(items: T[], size: number): T[][] => {
  if (size < 1) throw new Error("Batch size must be at least 1");
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
};

export interface BatchOptions {
  /** Maximum number of items per request. Defaults to 5. */
  batchSize?: number;
  /** Delay in milliseconds between batches. Defaults to 250. */
  delayMs?: number;
  /** Called after each batch resolves, with the number of items processed so far. */
  onProgress?: (processed: number, total: number) => void;
}

/**
 * Runs `handler` over `items` in sequential batches, pausing `delayMs`
 * between each batch. Returns the handler results in batch order.
 */
export const runBatched = async <T, R>(
  items: T[],
  handler: (batch: T[], batchIndex: number) => Promise<R>,
  options: BatchOptions = {}
): Promise<R[]> => {
  const { batchSize = 5, delayMs = 250, onProgress } = options;
  const batches = chunk(items, batchSize);
  const results: R[] = [];
  let processed = 0;

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) await sleep(delayMs);
    results.push(await handler(batches[i], i));
    processed += batches[i].length;
    onProgress?.(processed, items.length);
  }

  return results;
};
