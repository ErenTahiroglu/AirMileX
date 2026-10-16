import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  QUICK_GEOCODE_PROVIDERS,
  QUICK_ROUTE_PROVIDERS,
  QUICK_DISTANCE_IP_LIMIT_PER_HOUR,
  QUICK_DISTANCE_GLOBAL_LIMIT_PER_DAY,
  quickDistanceUsesDemoServers,
} from "./quick-distance-providers.ts";

describe("AirMileX Phase 3: Quick Distance Provider Safety & Rate Limits", () => {
  it("uses only operator-managed Geoapify for geocoding and routing", () => {
    expect([...QUICK_GEOCODE_PROVIDERS]).toEqual(["geoapify"]);
    expect([...QUICK_ROUTE_PROVIDERS]).toEqual(["geoapify"]);
    expect(quickDistanceUsesDemoServers()).toBe(false);
  });

  it("enforces strict rate limits: 5/hr/IP and 200/day globally", () => {
    expect(QUICK_DISTANCE_IP_LIMIT_PER_HOUR).toBe(5);
    expect(QUICK_DISTANCE_GLOBAL_LIMIT_PER_DAY).toBe(200);
  });

  it("endpoint source never calls public Nominatim or public OSRM demo servers", () => {
    const src = readFileSync(resolve(__dirname, "../quick-distance/index.ts"), "utf8");
    for (const banned of ["nominatimGeocode", "osrmRoute", "nominatimAutocomplete", "router.project-osrm.org", "nominatim.openstreetmap.org"]) {
      expect(src).not.toContain(banned);
    }
  });

  it("endpoint source requires operator GEOAPIFY_API_KEY", () => {
    const src = readFileSync(resolve(__dirname, "../quick-distance/index.ts"), "utf8");
    expect(src).toContain("GEOAPIFY_API_KEY");
    expect(src).toContain("geoapifyGeocode");
    expect(src).toContain("geoapifyRoute");
  });
});
