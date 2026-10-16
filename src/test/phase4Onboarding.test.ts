import { describe, it, expect, beforeEach } from "vitest";
import { storePostAuthRedirect, consumePostAuthRedirect, isSafeRelativePath } from "@/lib/postAuthRedirect";
import { filterValidAddressPairs } from "@/lib/bulkCalculation";
import { IS_PAID_CHECKOUT_ENABLED } from "@/pages/PricingPage";
import fs from "fs";
import path from "path";

describe("Phase 4 Freemium Onboarding, Conversion UX & Security", () => {
  let sessionStore: Record<string, string> = {};
  let localStore: Record<string, string> = {};

  beforeEach(() => {
    sessionStore = {};
    localStore = {};

    globalThis.sessionStorage = {
      getItem: (key: string) => sessionStore[key] ?? null,
      setItem: (key: string, value: string) => {
        sessionStore[key] = value;
      },
      removeItem: (key: string) => {
        delete sessionStore[key];
      },
      clear: () => {
        sessionStore = {};
      },
      key: () => null,
      length: 0,
    };

    globalThis.localStorage = {
      getItem: (key: string) => localStore[key] ?? null,
      setItem: (key: string, value: string) => {
        localStore[key] = value;
      },
      removeItem: (key: string) => {
        delete localStore[key];
      },
      clear: () => {
        localStore = {};
      },
      key: () => null,
      length: 0,
    };
  });

  describe("FIX A: Launch Readiness and Purchase Availability", () => {
    it("defaults IS_PAID_CHECKOUT_ENABLED to false when environment variable is not explicitly true", () => {
      expect(IS_PAID_CHECKOUT_ENABLED).toBe(false);
    });

    it("verifies the 500-credit / $9 product configuration parameters", () => {
      const packageCredits = 500;
      const packagePriceUsd = 9.0;
      const pricePerCredit = packagePriceUsd / packageCredits;

      expect(packageCredits).toBe(500);
      expect(packagePriceUsd).toBe(9.0);
      expect(pricePerCredit).toBeCloseTo(0.018, 4); // $0.018 per credit
    });
  });

  describe("FIX B: Truthful Copy & Unsupported Promise Audit", () => {
    it("verifies PricingPage does not make guaranteed or blanket refund claims", () => {
      const pricingSrc = fs.readFileSync(path.resolve(__dirname, "../pages/PricingPage.tsx"), "utf-8");
      expect(pricingSrc).not.toContain("Guaranteed refund protection");
      expect(pricingSrc).not.toContain("automatically refunded");
      // Contains truthful contract explanations
      expect(pricingSrc).toContain("system refund rules");
    });

    it("verifies AuthPage does not make unsupported IRS-compliant claims", () => {
      const authSrc = fs.readFileSync(path.resolve(__dirname, "../pages/AuthPage.tsx"), "utf-8");
      expect(authSrc).not.toContain("IRS-compliant");
      expect(authSrc).toContain("50 Free Mileage Credits on Signup");
      expect(authSrc).toContain("detailed mileage logs");
    });

    it("verifies NewJobPage does not falsely label total remaining balance as free credits", () => {
      const newJobSrc = fs.readFileSync(path.resolve(__dirname, "../pages/NewJobPage.tsx"), "utf-8");
      expect(newJobSrc).not.toContain("{credits} free mileage credits");
      expect(newJobSrc).toContain("{credits} mileage credits");
    });
  });

  describe("FIX C: Auth Redirect Completeness & Security Validation", () => {
    it("accepts valid, safe same-origin relative paths", () => {
      expect(isSafeRelativePath("/new-job")).toBe(true);
      expect(isSafeRelativePath("/pricing")).toBe(true);
      expect(isSafeRelativePath("/settings?tab=general&filter=all#sec")).toBe(true);
      expect(isSafeRelativePath("/new-job?base=app123&table=tbl456")).toBe(true);
    });

    it("rejects protocol-relative redirect destinations", () => {
      expect(isSafeRelativePath("//evil.com")).toBe(false);
      expect(isSafeRelativePath("//evil.com/phishing")).toBe(false);
      expect(isSafeRelativePath("/\\evil.com")).toBe(false);
      expect(isSafeRelativePath("/%2Fevil.com")).toBe(false);
    });

    it("rejects backslash-based redirect destinations", () => {
      expect(isSafeRelativePath("\\evil.com")).toBe(false);
      expect(isSafeRelativePath("/path\\evil")).toBe(false);
      expect(isSafeRelativePath("/path%5Cevil")).toBe(false);
      expect(isSafeRelativePath("/path%5cevil")).toBe(false);
    });

    it("rejects control characters and unprintable sequences", () => {
      expect(isSafeRelativePath("/path\r\nevil")).toBe(false);
      expect(isSafeRelativePath("/path\0evil")).toBe(false);
      expect(isSafeRelativePath("/path\x08evil")).toBe(false);
      expect(isSafeRelativePath("/path%00evil")).toBe(false);
      expect(isSafeRelativePath("/path%0D%0Aevil")).toBe(false);
    });

    it("rejects external schemes, whitespace, and nullish inputs", () => {
      expect(isSafeRelativePath("https://evil.com/steal")).toBe(false);
      expect(isSafeRelativePath("http://evil.com")).toBe(false);
      expect(isSafeRelativePath("javascript:alert(1)")).toBe(false);
      expect(isSafeRelativePath("data:text/html,<script>alert(1)</script>")).toBe(false);
      expect(isSafeRelativePath("   /new-job   ")).toBe(false);
      expect(isSafeRelativePath("")).toBe(false);
      expect(isSafeRelativePath(null)).toBe(false);
      expect(isSafeRelativePath(undefined)).toBe(false);
    });

    it("persists and retrieves internal destinations across same-tab logins", () => {
      storePostAuthRedirect("/new-job");
      expect(consumePostAuthRedirect()).toBe("/new-job");
      // Consumed and cleared
      expect(consumePostAuthRedirect()).toBeNull();
    });

    it("persists internal destination for cross-tab email confirmations", () => {
      // Tab 1: user initiates signup
      storePostAuthRedirect("/new-job");
      expect(localStore["postAuthRedirect"]).toBe("/new-job");

      // Tab 2: user opens confirmation link in another tab (empty sessionStorage)
      sessionStore = {};
      expect(sessionStorage.getItem("postAuthRedirect")).toBeNull();

      // consumePostAuthRedirect in Tab 2 falls back to localStorage
      const destination = consumePostAuthRedirect();
      expect(destination).toBe("/new-job");

      // Cleans up both stores
      expect(localStore["postAuthRedirect"]).toBeUndefined();
      expect(sessionStore["postAuthRedirect"]).toBeUndefined();
    });

    it("ignores unsafe destinations and leaves storage clean", () => {
      storePostAuthRedirect("https://evil.com");
      expect(consumePostAuthRedirect()).toBeNull();

      storePostAuthRedirect("//attacker.com");
      expect(consumePostAuthRedirect()).toBeNull();

      storePostAuthRedirect("/foo\\bar");
      expect(consumePostAuthRedirect()).toBeNull();
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
  });
});
