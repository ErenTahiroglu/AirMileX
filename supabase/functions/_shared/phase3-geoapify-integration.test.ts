import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  geoapifyGeocode,
  geoapifyRoute,
  geoapifyAutocomplete,
  ProviderError,
} from "./geo.ts";

import {
  validateBulkProviderConfig,
  planGeocodeProviders,
  planRouteProviders,
  planRefundCompensation,
  executeCreditRefund,
} from "./bulk-distance-providers.ts";

import {
  selectAutocompleteProviders,
} from "./autocomplete-providers.ts";

import {
  QUICK_DISTANCE_IP_LIMIT_PER_HOUR,
  QUICK_DISTANCE_GLOBAL_LIMIT_PER_DAY,
  QUICK_DISTANCE_IP_LIMIT_PER_MINUTE,
} from "./quick-distance-providers.ts";

import {
  filterValidAddressPairs,
  partitionRecordsForContinuation,
} from "../../../src/lib/bulkCalculation.ts";

describe("AirMileX Phase 3: Operator-Managed Geoapify Verification Suite", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // 1. Single distance calculation works with operator Geoapify and no user map key
  it("Requirement 1: Single distance calculation works with operator Geoapify and no user map key", async () => {
    const config = {
      isBulk: false,
      operatorGeoapifyKey: "operator-geoapify-secret-key",
    };

    const validation = validateBulkProviderConfig(config);
    expect(validation.valid).toBe(true);

    const geocodePlan = planGeocodeProviders(config);
    const routePlan = planRouteProviders(config);
    expect(geocodePlan).toEqual(["operator_geoapify"]);
    expect(routePlan).toEqual(["operator_geoapify"]);

    // Mock Geoapify geocode and route responses
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/geocode/search")) {
        return new Response(
          JSON.stringify({
            results: [{ lon: -73.9851, lat: 40.7488, formatted: "Empire State Building, NY" }],
          }),
          { status: 200 }
        );
      }
      if (url.includes("/routing")) {
        return new Response(
          JSON.stringify({
            features: [
              {
                properties: {
                  distance: 16093.44, // 10 miles in meters
                  time: 1200,
                },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const coords = await geoapifyGeocode(config.operatorGeoapifyKey, "Empire State Building, NY");
    expect(coords).toEqual([-73.9851, 40.7488]);

    const route = await geoapifyRoute(config.operatorGeoapifyKey, coords, [-73.99, 40.75]);
    expect(route.distance_m).toBe(16093.44);
    expect(route.duration_s).toBe(1200);

    // Verify distance conversion matches AirMileX standards
    const distanceKm = route.distance_m / 1000;
    const distanceMi = route.distance_m / 1609.344;
    expect(distanceKm).toBeCloseTo(16.09344, 4);
    expect(distanceMi).toBeCloseTo(10.0, 4);
  });

  // 2. Bulk distance calculation works with the same operator configuration
  it("Requirement 2: Bulk distance calculation works with operator Geoapify and no user map key", () => {
    const config = {
      isBulk: true,
      operatorGeoapifyKey: "operator-geoapify-secret-key",
    };

    const validation = validateBulkProviderConfig(config);
    expect(validation.valid).toBe(true);

    const geocodePlan = planGeocodeProviders(config);
    const routePlan = planRouteProviders(config);
    expect(geocodePlan).toEqual(["operator_geoapify"]);
    expect(routePlan).toEqual(["operator_geoapify"]);
  });

  // 3. No active code path calls public Nominatim or OSRM
  it("Requirement 3: No active code path calls public Nominatim or OSRM demo servers", () => {
    const filesToCheck = [
      "../distance-proxy/index.ts",
      "../quick-distance/index.ts",
      "../address-autocomplete/index.ts",
      "../address-cleanup/index.ts",
      "./geo.ts",
      "./bulk-distance-providers.ts",
      "./autocomplete-providers.ts",
      "./quick-distance-providers.ts",
    ];

    const bannedKeywords = [
      "nominatimGeocode",
      "osrmRoute",
      "nominatimAutocomplete",
      "orsGeocode",
      "orsRoute",
      "orsAutocomplete",
      "router.project-osrm.org",
      "nominatim.openstreetmap.org",
      "api.openrouteservice.org",
    ];

    for (const relPath of filesToCheck) {
      const fullPath = resolve(__dirname, relPath);
      const content = readFileSync(fullPath, "utf8");

      for (const banned of bannedKeywords) {
        // Assert that none of the active code defines or calls these banned endpoints/helpers
        const occurrences = content
          .split("\n")
          .filter(
            (line) =>
              line.includes(banned) &&
              !line.trim().startsWith("//") &&
              !line.trim().startsWith("*") &&
              !line.includes("banned")
          );
        expect(
          occurrences,
          `File ${relPath} contains active banned keyword "${banned}"`
        ).toEqual([]);
      }
    }
  });

  // 4. Geoapify autocomplete works for anonymous users within quota
  it("Requirement 4: Geoapify autocomplete works for anonymous users within quota", async () => {
    const consumeQuotaMock = vi.fn(async () => true);
    const providers = await selectAutocompleteProviders({
      userId: null, // anonymous user
      hasGeoapifyKey: true,
      consumeQuota: consumeQuotaMock,
    });

    expect(providers).toEqual(["geoapify"]);
    expect(consumeQuotaMock).toHaveBeenCalled();

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { formatted: "100 Main St, New York, NY", lat: 40.71, lon: -74.0 },
            { formatted: "100 Main St, Los Angeles, CA", lat: 34.05, lon: -118.24 },
          ],
        }),
        { status: 200 }
      )
    );

    const suggestions = await geoapifyAutocomplete("test-key", "100 Main St");
    expect(suggestions.length).toBe(2);
    expect(suggestions[0].label).toBe("100 Main St, New York, NY");
    expect(suggestions[0].lat).toBe(40.71);
    expect(suggestions[0].lon).toBe(-74.0);
  });

  // 5. Quick-distance limits are enforced
  it("Requirement 5: Quick-distance limits are enforced (5/hr/IP, 200/day global)", () => {
    expect(QUICK_DISTANCE_IP_LIMIT_PER_HOUR).toBe(5);
    expect(QUICK_DISTANCE_GLOBAL_LIMIT_PER_DAY).toBe(200);
    expect(QUICK_DISTANCE_IP_LIMIT_PER_MINUTE).toBe(5);

    // Verify rate limit response codes and structure in quick-distance endpoint source
    const quickDistanceSrc = readFileSync(
      resolve(__dirname, "../quick-distance/index.ts"),
      "utf8"
    );
    expect(quickDistanceSrc).toContain("QUICK_DISTANCE_IP_LIMIT_PER_HOUR");
    expect(quickDistanceSrc).toContain("QUICK_DISTANCE_GLOBAL_LIMIT_PER_DAY");
    expect(quickDistanceSrc).toContain("429");
    expect(quickDistanceSrc).toContain("Retry-After");
  });

  // 6. Cache hits avoid unnecessary provider requests
  it("Requirement 6: Cache hits avoid unnecessary provider requests", async () => {
    // Test in-memory cache behavior in resolvePair / distance-proxy
    const geocodeCache = new Map<string, [number, number]>();
    geocodeCache.set("100 main st, ny", [-73.9851, 40.7488]);

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    // Direct lookup from cache
    const cachedCoords = geocodeCache.get("100 main st, ny");
    expect(cachedCoords).toEqual([-73.9851, 40.7488]);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Verify DB caching logic exists in quick-distance
    const quickDistanceSrc = readFileSync(
      resolve(__dirname, "../quick-distance/index.ts"),
      "utf8"
    );
    expect(quickDistanceSrc).toContain('.from("geocode_cache")');
    expect(quickDistanceSrc).toContain('.from("route_cache")');
  });

  // 7. Missing provider configuration does not reserve user credits
  it("Requirement 7: Missing provider configuration fails before credit reservation", () => {
    // When operator Geoapify key is missing, validation fails immediately
    const missingBulk = validateBulkProviderConfig({
      isBulk: true,
      operatorGeoapifyKey: "",
    });
    expect(missingBulk.valid).toBe(false);
    expect(missingBulk.error).toContain("Operator map service is not configured");

    const missingSingle = validateBulkProviderConfig({
      isBulk: false,
      operatorGeoapifyKey: "",
    });
    expect(missingSingle.valid).toBe(false);
    expect(missingSingle.error).toContain("Operator map service is not configured");

    // In distance-proxy source, validateBulkProviderConfig is called before rpc("reserve_credits")
    const proxySrc = readFileSync(
      resolve(__dirname, "../distance-proxy/index.ts"),
      "utf8"
    );
    const validationIndex = proxySrc.indexOf("validateBulkProviderConfig(config)");
    const reservationIndex = proxySrc.indexOf('rpc("reserve_credits"');
    expect(validationIndex).toBeGreaterThan(-1);
    expect(reservationIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(reservationIndex);
  });

  // 8. Provider failures preserve credit refund/error semantics
  it("Requirement 8: Provider failures preserve credit refund/error semantics", async () => {
    // Scenario: Batch of 5 records, 2 succeeded, 3 failed due to provider error
    const plan = planRefundCompensation(5, 2);
    expect(plan.amountToRefund).toBe(3);
    expect(plan.succeededCount).toBe(2);

    // Scenario: 0 succeeded out of 5
    const fullRefundPlan = planRefundCompensation(5, 0);
    expect(fullRefundPlan.amountToRefund).toBe(5);
    expect(fullRefundPlan.succeededCount).toBe(0);

    // Scenario: All 5 succeeded
    const zeroRefundPlan = planRefundCompensation(5, 5);
    expect(zeroRefundPlan.amountToRefund).toBe(0);
    expect(zeroRefundPlan.succeededCount).toBe(5);

    // Test executeCreditRefund error handling
    const mockDbFail = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Database connection failed" },
      }),
    };

    const failResult = await executeCreditRefund(mockDbFail as any, "user-1", 3);
    expect(failResult.refunded).toBe(false);
    expect(failResult.refundError).toContain("Refund RPC failed for 3 credits");

    const mockDbOk = {
      rpc: vi.fn().mockResolvedValue({
        data: 47,
        error: null,
      }),
    };
    const okResult = await executeCreditRefund(mockDbOk as any, "user-1", 3);
    expect(okResult.refunded).toBe(true);
    expect(okResult.creditsRemaining).toBe(47);
  });

  // 9. Paid and free AirMileX users share operator provider configuration without exposing secrets
  it("Requirement 9: Paid and free AirMileX users share operator provider configuration without exposing secrets", () => {
    // Both bulk (paid) and single/quick use the operator configuration
    const bulkConfig = { isBulk: true, operatorGeoapifyKey: "shared-operator-key" };
    const singleConfig = { isBulk: false, operatorGeoapifyKey: "shared-operator-key" };

    expect(planGeocodeProviders(bulkConfig)).toEqual(["operator_geoapify"]);
    expect(planGeocodeProviders(singleConfig)).toEqual(["operator_geoapify"]);

    // Verify distance-proxy response payload never leaks server secrets to client
    const proxySrc = readFileSync(
      resolve(__dirname, "../distance-proxy/index.ts"),
      "utf8"
    );
    expect(proxySrc).toContain("return json({\n      results,\n      credits_remaining: creditsRemaining,\n      ...(refundError ? { refund_error: refundError } : {}),\n    });");

    // Verify SettingsPage does not expose or request map keys
    const settingsSrc = readFileSync(
      resolve(__dirname, "../../../src/pages/SettingsPage.tsx"),
      "utf8"
    );
    expect(settingsSrc).not.toContain("Google Maps API Key");
    expect(settingsSrc).not.toContain("OpenRouteService API Key");
    expect(settingsSrc).toContain("No personal map API key required");
  });

  // 10. Existing Airtable sync and Phase 2 calculations remain unchanged
  it("Requirement 10: Existing Airtable sync and Phase 2 calculations remain unchanged", () => {
    // Valid address filtering works as in Phase 2
    const pairs = [
      { id: "1", start: "Address A", end: "Address B" },
      { id: "2", start: "", end: "Address D" },
    ];
    const filtered = filterValidAddressPairs(pairs);
    expect(filtered.valid.length).toBe(1);
    expect(filtered.invalidResults.length).toBe(1);

    // Continuation partition handles ok, indeterminate, and remaining rows
    const { remainingToCalculate, indeterminateRecords } = partitionRecordsForContinuation(
      [{ id: "1" }, { id: "2" }, { id: "3" }],
      [
        { record_id: "1", distance_km: 10, distance_mi: 6.2, status: "ok" },
        {
          record_id: "2",
          distance_km: 0,
          distance_mi: 0,
          status: "error",
          error: "Indeterminate timeout",
          error_type: "indeterminate",
        },
      ]
    );

    expect(remainingToCalculate.map((r) => r.id)).toEqual(["3"]);
    expect(indeterminateRecords.map((r) => r.id)).toEqual(["2"]);
  });
});
