import { describe, expect, it } from "vitest";
import {
  planGeocodeProviders,
  planRouteProviders,
  planRefundCompensation,
  validateBulkProviderConfig,
  type BulkProviderConfig,
} from "./bulk-distance-providers.ts";


describe("AirMileX Phase 3: Operator-Managed Geoapify Distance Provider Safety", () => {
  it("rejects calculation if operator Geoapify key is missing, for both bulk and single modes", () => {
    const bulkConfig: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "",
    };
    const bulkValidation = validateBulkProviderConfig(bulkConfig);
    expect(bulkValidation.valid).toBe(false);
    expect(bulkValidation.error).toContain("Operator map service is not configured");

    const singleConfig: BulkProviderConfig = {
      isBulk: false,
      operatorGeoapifyKey: "",
    };
    const singleValidation = validateBulkProviderConfig(singleConfig);
    expect(singleValidation.valid).toBe(false);
    expect(singleValidation.error).toContain("Operator map service is not configured");
  });

  it("accepts calculation when operator Geoapify key is configured without requiring user key (bulk & single)", () => {
    const bulkConfig: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify_operator",
      userKey: "",
    };
    const bulkValidation = validateBulkProviderConfig(bulkConfig);
    expect(bulkValidation.valid).toBe(true);
    expect(bulkValidation.error).toBeUndefined();

    const singleConfig: BulkProviderConfig = {
      isBulk: false,
      operatorGeoapifyKey: "sec_geoapify_operator",
      userKey: "",
    };
    const singleValidation = validateBulkProviderConfig(singleConfig);
    expect(singleValidation.valid).toBe(true);
    expect(singleValidation.error).toBeUndefined();
  });

  it("never includes public Nominatim in geocode attempts for either bulk or single mode", () => {
    const bulkConfig: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify",
    };
    const bulkProviders = planGeocodeProviders(bulkConfig);
    expect(bulkProviders).not.toContain("nominatim");
    expect(bulkProviders).toEqual(["operator_geoapify"]);

    const singleConfig: BulkProviderConfig = {
      isBulk: false,
      operatorGeoapifyKey: "sec_geoapify",
    };
    const singleProviders = planGeocodeProviders(singleConfig);
    expect(singleProviders).not.toContain("nominatim");
    expect(singleProviders).toEqual(["operator_geoapify"]);
  });

  it("never includes public OSRM in route attempts for either bulk or single mode", () => {
    const bulkConfig: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify",
    };
    const bulkProviders = planRouteProviders(bulkConfig);
    expect(bulkProviders).not.toContain("osrm");
    expect(bulkProviders).toEqual(["operator_geoapify"]);

    const singleConfig: BulkProviderConfig = {
      isBulk: false,
      operatorGeoapifyKey: "sec_geoapify",
    };
    const singleProviders = planRouteProviders(singleConfig);
    expect(singleProviders).not.toContain("osrm");
    expect(singleProviders).toEqual(["operator_geoapify"]);
  });

  it("uses operator Geoapify ONLY, completely ignoring user-provided keys", () => {
    const configWithUserKey: BulkProviderConfig = {
      isBulk: true,
      operatorGeoapifyKey: "sec_geoapify_operator",
      userProvider: "geoapify",
      userKey: "user_personal_key",
    };
    const geoProviders = planGeocodeProviders(configWithUserKey);
    const routeProviders = planRouteProviders(configWithUserKey);

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

