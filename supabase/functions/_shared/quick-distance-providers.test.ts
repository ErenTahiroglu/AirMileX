import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  QUICK_GEOCODE_PROVIDERS,
  QUICK_ROUTE_PROVIDERS,
  quickDistanceUsesPaidProvider,
} from "./quick-distance-providers.ts";

describe("anonymous quick-distance providers", () => {
  it("uses only Nominatim for geocoding and OSRM for routing", () => {
    expect([...QUICK_GEOCODE_PROVIDERS]).toEqual(["nominatim"]);
    expect([...QUICK_ROUTE_PROVIDERS]).toEqual(["osrm"]);
    expect(quickDistanceUsesPaidProvider()).toBe(false);
  });

  it("endpoint source never reads paid-provider secrets or calls paid helpers", () => {
    const src = readFileSync(resolve(__dirname, "../quick-distance/index.ts"), "utf8");
    for (const banned of ["GEOAPIFY", "OPENROUTESERVICE", "geoapifyGeocode", "geoapifyRoute", "orsGeocode", "orsRoute", "GOOGLE"]) {
      expect(src).not.toContain(banned);
    }
  });
});
