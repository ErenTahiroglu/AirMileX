import { lazy, type ComponentType } from "react";

/**
 * Checks whether an error is specifically an asset/chunk loading error
 * (e.g., HTTP 404 on deployment rotation, network drop while fetching chunk, etc.).
 * Unrelated runtime errors (e.g. TypeErrors, syntax errors, render exceptions) return false.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const err = error as { name?: string; message?: string };
    if (err.name === "ChunkLoadError") return true;
    const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
    return (
      msg.includes("loading chunk") ||
      msg.includes("failed to fetch dynamically imported module") ||
      msg.includes("error loading dynamically imported module") ||
      msg.includes("importing a module script failed") ||
      msg.includes("failed to load module script")
    );
  }
  return false;
}

export interface LazyWithRetryOptions {
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reloadFn?: () => void;
}

/**
 * Core async loader factory implementing chunk retry logic.
 */
export function createRetryableLoader<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  chunkKey: string,
  options?: LazyWithRetryOptions
): () => Promise<{ default: T }> {
  const getStorage = () => options?.storage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  const doReload = options?.reloadFn ?? (() => {
    if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
      window.location.reload();
    }
  });

  return async () => {
    const storageKey = `chunk_retry_${chunkKey}`;
    try {
      const module = await componentImport();
      // On successful module load, clear the retry flag for this chunk
      try {
        getStorage()?.removeItem(storageKey);
      } catch {
        // Ignore storage access errors
      }
      return module;
    } catch (error) {
      if (isChunkLoadError(error)) {
        let hasRefreshed = false;
        try {
          hasRefreshed = Boolean(getStorage()?.getItem(storageKey));
        } catch {
          // Ignore storage access errors
        }

        if (!hasRefreshed) {
          try {
            getStorage()?.setItem(storageKey, "true");
          } catch {
            // Ignore storage access errors
          }
          doReload();
        }
      }
      throw error;
    }
  };
}

/**
 * Wraps dynamic component imports with automatic single-retry reload on chunk load failure.
 *
 * Guarantees:
 * - Scoped per chunk key (e.g. chunk_retry_dashboard).
 * - Cleared immediately upon successful module import so future application updates can retry again.
 * - Prevents infinite refresh loops: if a reload has already been performed for this chunk key in the current session, it does not reload again and lets ErrorBoundary display the fallback.
 * - Non-chunk runtime errors are never reloaded.
 * - Safe against sessionStorage errors (e.g. private browsing storage limits).
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  chunkKey: string,
  options?: LazyWithRetryOptions
) {
  return lazy(createRetryableLoader(componentImport, chunkKey, options));
}
