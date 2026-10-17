import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, createRetryableLoader } from "./lazyWithRetry";

describe("lazyWithRetry & isChunkLoadError Unit Tests", () => {
  describe("isChunkLoadError", () => {
    it("identifies ChunkLoadError by name", () => {
      const err = new Error("Loading chunk 4 failed.");
      err.name = "ChunkLoadError";
      expect(isChunkLoadError(err)).toBe(true);
    });

    it("identifies standard Vite/Chromium/WebKit dynamic import error messages", () => {
      expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://app.lovable.dev/assets/Dashboard-123.js"))).toBe(true);
      expect(isChunkLoadError(new Error("error loading dynamically imported module"))).toBe(true);
      expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
      expect(isChunkLoadError(new Error("Failed to load module script: Expected a JavaScript module script"))).toBe(true);
    });

    it("rejects standard application runtime errors to prevent reload loops", () => {
      expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
      expect(isChunkLoadError(new ReferenceError("foo is not defined"))).toBe(false);
      expect(isChunkLoadError(new Error("Validation failed"))).toBe(false);
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
      expect(isChunkLoadError({})).toBe(false);
    });
  });

  describe("createRetryableLoader behavior", () => {
    const createMockStorage = () => {
      const store = new Map<string, string>();
      return {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, val: string) => store.set(key, val)),
        removeItem: vi.fn((key: string) => store.delete(key)),
      };
    };

    it("successful import resolves cleanly and cleans up any existing retry flag", async () => {
      const storage = createMockStorage();
      storage.setItem("chunk_retry_dashboard", "true");
      const reloadFn = vi.fn();

      const MockComponent = () => null;
      const importer = vi.fn().mockResolvedValue({ default: MockComponent });

      const loader = createRetryableLoader(importer, "dashboard", {
        storage,
        reloadFn,
      });

      const res = await loader();

      expect(res.default).toBe(MockComponent);
      expect(storage.removeItem).toHaveBeenCalledWith("chunk_retry_dashboard");
      expect(reloadFn).not.toHaveBeenCalled();
    });

    it("first chunk failure sets storage flag, invokes reloadFn, and propagates error", async () => {
      const storage = createMockStorage();
      const reloadFn = vi.fn();

      const chunkError = new Error("Failed to fetch dynamically imported module");
      const importer = vi.fn().mockRejectedValue(chunkError);

      const loader = createRetryableLoader(importer, "pricing", {
        storage,
        reloadFn,
      });

      let thrown: any = null;
      try {
        await loader();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBe(chunkError);
      expect(storage.setItem).toHaveBeenCalledWith("chunk_retry_pricing", "true");
      expect(reloadFn).toHaveBeenCalledTimes(1);
    });

    it("repeated failure after reload does NOT trigger another reload (prevents infinite refresh loops)", async () => {
      const storage = createMockStorage();
      storage.setItem("chunk_retry_settings", "true");
      const reloadFn = vi.fn();

      const chunkError = new Error("Failed to fetch dynamically imported module: persistent 404");
      const importer = vi.fn().mockRejectedValue(chunkError);

      const loader = createRetryableLoader(importer, "settings", {
        storage,
        reloadFn,
      });

      let thrown: any = null;
      try {
        await loader();
      } catch (err) {
        thrown = err;
      }

      // Must throw to error boundary and NOT call reload again
      expect(thrown).toBe(chunkError);
      expect(reloadFn).not.toHaveBeenCalled();
    });

    it("non-chunk runtime error throws immediately without triggering page reload", async () => {
      const storage = createMockStorage();
      const reloadFn = vi.fn();

      const runtimeError = new TypeError("Cannot read properties of null (reading 'useState')");
      const importer = vi.fn().mockRejectedValue(runtimeError);

      const loader = createRetryableLoader(importer, "new-job", {
        storage,
        reloadFn,
      });

      let thrown: any = null;
      try {
        await loader();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBe(runtimeError);
      expect(reloadFn).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    it("subsequent successful load clears flag so future deployment chunk updates can retry cleanly", async () => {
      const storage = createMockStorage();
      const reloadFn = vi.fn();

      // Step 1: Chunk failure triggers reload
      const chunkError = new Error("Failed to fetch dynamically imported module: stale-hash");
      const failingImporter = vi.fn().mockRejectedValue(chunkError);
      const failingLoader = createRetryableLoader(failingImporter, "terms", { storage, reloadFn });

      try {
        await failingLoader();
      } catch {
        // expected
      }
      expect(storage.setItem).toHaveBeenCalledWith("chunk_retry_terms", "true");
      expect(reloadFn).toHaveBeenCalledTimes(1);

      // Step 2: User gets new chunk after reload, successful load clears the flag
      const MockComponent = () => null;
      const successImporter = vi.fn().mockResolvedValue({ default: MockComponent });
      const successLoader = createRetryableLoader(successImporter, "terms", { storage, reloadFn });

      const res = await successLoader();
      expect(res.default).toBe(MockComponent);
      expect(storage.removeItem).toHaveBeenCalledWith("chunk_retry_terms");
    });
  });
});
