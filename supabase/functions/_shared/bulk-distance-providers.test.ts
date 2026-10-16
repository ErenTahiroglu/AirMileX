import { describe, expect, it } from "vitest";
import {
  planGeocodeProviders,
  planRouteProviders,
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
});
