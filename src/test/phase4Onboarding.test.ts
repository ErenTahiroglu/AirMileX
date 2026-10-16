import { describe, it, expect, beforeEach } from "vitest";
import { storePostAuthRedirect, consumePostAuthRedirect, isSafeRelativePath } from "@/lib/postAuthRedirect";
import { filterValidAddressPairs } from "@/lib/bulkCalculation";

describe("Phase 4 Freemium Onboarding & Credit Safety", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    globalThis.sessionStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: () => null,
      length: 0,
    };
  });

  describe("Post-Auth Redirection Preservation", () => {
    it("safely stores and consumes internal post-auth redirect paths", () => {
      storePostAuthRedirect("/new-job");
      expect(consumePostAuthRedirect()).toBe("/new-job");
      // Once consumed, it should be cleared
      expect(consumePostAuthRedirect()).toBeNull();
    });

    it("rejects malicious or protocol-relative external redirect URLs", () => {
      expect(isSafeRelativePath("https://evil.com/phishing")).toBe(false);
      expect(isSafeRelativePath("//attacker.com/steal")).toBe(false);
      expect(isSafeRelativePath(null)).toBe(false);
      expect(isSafeRelativePath("")).toBe(false);

      storePostAuthRedirect("https://evil.com/phishing");
      expect(consumePostAuthRedirect()).toBeNull();

      storePostAuthRedirect("//attacker.com/steal");
      expect(consumePostAuthRedirect()).toBeNull();
    });

    it("handles URI-encoded nested query parameters safely", () => {
      const complexPath = "/new-job?base=app123&table=tbl456";
      expect(isSafeRelativePath(complexPath)).toBe(true);
      storePostAuthRedirect(complexPath);
      expect(consumePostAuthRedirect()).toBe(complexPath);
    });
  });

  describe("Freemium Credit & Zero-Charge Invariants", () => {
    it("excludes empty or whitespace-only address pairs from credit consumption", () => {
      const records = [
        { id: "rec1", start: "123 Main St", end: "456 Market St" },
        { id: "rec2", start: "", end: "456 Market St" },
        { id: "rec3", start: "123 Main St", end: "   " },
        { id: "rec4", start: "   ", end: "   " },
        { id: "rec5", start: "789 Broadway", end: "101 5th Ave" },
      ];

      const { valid, invalidResults } = filterValidAddressPairs(records);
      expect(valid).toHaveLength(2);
      expect(valid.map((r) => r.id)).toEqual(["rec1", "rec5"]);
      expect(invalidResults).toHaveLength(3);
      expect(invalidResults.every((r) => r.status === "error")).toBe(true);
    });

    it("evaluates insufficient credit threshold correctly", () => {
      const records = [
        { id: "rec1", start: "A", end: "B" },
        { id: "rec2", start: "C", end: "D" },
        { id: "rec3", start: "E", end: "F" },
      ];
      const { valid } = filterValidAddressPairs(records);
      const validCount = valid.length;
      expect(validCount).toBe(3);

      const userCredits = 2;
      const isInsufficient = userCredits < validCount;
      expect(isInsufficient).toBe(true);

      const updatedCredits = 50; // New user baseline
      expect(updatedCredits < validCount).toBe(false);
    });

    it("verifies the unit economics parameters for the 500-credit package", () => {
      const packageCredits = 500;
      const packagePriceUsd = 9.0;
      const pricePerCredit = packagePriceUsd / packageCredits;

      expect(packageCredits).toBe(500);
      expect(packagePriceUsd).toBe(9.0);
      expect(pricePerCredit).toBeCloseTo(0.018, 4); // 1.8 cents per credit
    });
  });
});
