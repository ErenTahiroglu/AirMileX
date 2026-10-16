import { describe, expect, it } from "vitest";
import {
  planGeocodeProviders,
  planRouteProviders,
  planRefundCompensation,
  validateBulkProviderConfig,
  type BulkProviderConfig,
} from "./bulk-distance-providers.ts";


describe("AirMileX Phase 2B: Bulk Distance Provider Safety", () => {
  it("rejects bulk calculation if operator keys are missing, even if user has no key", () => {
    const config: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "",
      operatorOrsKey: "",
    };
    const validation = validateBulkProviderConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Operator map service is not configured for bulk operations");
  });

  it("accepts bulk calculation when operator Geoapify key is configured without requiring user key", () => {
    const config: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify_operator",
      userKey: "",
    };
    const validation = validateBulkProviderConfig(config);
    expect(validation.valid).toBe(true);
    expect(validation.error).toBeUndefined();
  });

  it("accepts bulk calculation when operator ORS key is configured without requiring user key", () => {
    const config: BulkProviderConfig = {
      isBulk: true,
      operatorOrsKey: "sec_ors_operator",
      userKey: "",
    };
    const validation = validateBulkProviderConfig(config);
    expect(validation.valid).toBe(true);
    expect(validation.error).toBeUndefined();
  });

  it("never includes public Nominatim in bulk geocode attempts", () => {
    const bulkConfig: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify",
      operatorOrsKey: "sec_ors",
    };
    const providers = planGeocodeProviders(bulkConfig);
    expect(providers).not.toContain("nominatim");
    expect(providers).toEqual(["operator_geoapify", "operator_ors"]);
  });

  it("never includes public OSRM in bulk route attempts", () => {
    const bulkConfig: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify",
      operatorOrsKey: "sec_ors",
    };
    const providers = planRouteProviders(bulkConfig);
    expect(providers).not.toContain("osrm");
    expect(providers).toEqual(["operator_geoapify", "operator_ors"]);
  });

  it("includes public Nominatim and OSRM for non-bulk single calculations as fallback", () => {
    const singleConfig: BulkProviderConfig = {
      isBulk: false,
      operatorGeoapifyKey: "sec_geoapify",
    };
    const geoProviders = planGeocodeProviders(singleConfig);
    const routeProviders = planRouteProviders(singleConfig);
    expect(geoProviders).toContain("nominatim");
    expect(routeProviders).toContain("osrm");
  });

  it("uses operator-managed providers ONLY in bulk mode, ignoring user keys", () => {
    const bulkConfigWithUserKey: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify_operator",
      userProvider: "geoapify",
      userKey: "user_personal_key",
    };
    const geoProviders = planGeocodeProviders(bulkConfigWithUserKey);
    const routeProviders = planRouteProviders(bulkConfigWithUserKey);

    expect(geoProviders).toEqual(["operator_geoapify"]);
    expect(geoProviders).not.toContain("user_geoapify");
    expect(routeProviders).toEqual(["operator_geoapify"]);
    expect(routeProviders).not.toContain("user_geoapify");
  });

  describe("Refund Integrity and Compensation", () => {
    it("never refunds successful calculations when batch aborts mid-way", () => {
      // 5 pairs total, 3 succeeded, 2 uncompleted/failed
      const plan = planRefundCompensation(5, 3);
      expect(plan.amountToRefund).toBe(2);
      expect(plan.succeededCount).toBe(3);
      expect(plan.failedCount).toBe(2);
    });

    it("refunds full batch when 0 succeeded", () => {
      const plan = planRefundCompensation(5, 0);
      expect(plan.amountToRefund).toBe(5);
    });

    it("refunds 0 when all pairs succeeded", () => {
      const plan = planRefundCompensation(5, 5);
      expect(plan.amountToRefund).toBe(0);
    });

    it("executeCreditRefund checks RPC errors and does NOT claim success on failure", async () => {
      const mockClient = {
        rpc: async () => ({
          data: null,
          error: { message: "connection to PostgreSQL broken" },
        }),
      };

      const result = await (await import("./bulk-distance-providers.ts")).executeCreditRefund(
        mockClient,
        "user_123",
        2
      );

      expect(result.refunded).toBe(false);
      expect(result.refundError).toContain("Refund RPC failed for 2 credits");
      expect(result.refundError).toContain("connection to PostgreSQL broken");
      expect(result.creditsRemaining).toBeUndefined();
    });

    it("executeCreditRefund returns updated credits remaining when RPC succeeds", async () => {
      const mockClient = {
        rpc: async () => ({
          data: 498,
          error: null,
        }),
      };

      const result = await (await import("./bulk-distance-providers.ts")).executeCreditRefund(
        mockClient,
        "user_123",
        2
      );

      expect(result.refunded).toBe(true);
      expect(result.refundError).toBeUndefined();
      expect(result.creditsRemaining).toBe(498);
    });
  });
});

