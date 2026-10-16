import { describe, expect, it, vi } from "vitest";
import { selectAutocompleteProviders } from "./autocomplete-providers.ts";

describe("selectAutocompleteProviders (Phase 3 Operator Geoapify)", () => {
  it("anonymous searches use operator Geoapify within quota and never touch Nominatim", async () => {
    const consumeQuota = vi.fn(async () => true);
    const result = await selectAutocompleteProviders({
      userId: null,
      hasGeoapifyKey: true,
      consumeQuota,
    });
    expect(result).toEqual(["geoapify"]);
    expect(result).not.toContain("nominatim");
    expect(consumeQuota).toHaveBeenCalled();
  });

  it("signed-in searches use operator Geoapify within quota and never touch Nominatim", async () => {
    const consumeQuota = vi.fn(async () => true);
    const result = await selectAutocompleteProviders({
      userId: "user-1",
      hasGeoapifyKey: true,
      consumeQuota,
    });
    expect(result).toEqual(["geoapify"]);
    expect(result).not.toContain("nominatim");
  });

  it("returns empty provider list when Geoapify key is missing (never falls back to demo servers)", async () => {
    const result = await selectAutocompleteProviders({
      userId: "user-1",
      hasGeoapifyKey: false,
    });
    expect(result).toEqual([]);
    expect(result).not.toContain("nominatim");
  });

  it("returns empty provider list when quota is exhausted (never falls back to demo servers)", async () => {
    const consumeQuota = vi.fn(async () => false);
    const result = await selectAutocompleteProviders({
      userId: "user-1",
      hasGeoapifyKey: true,
      consumeQuota,
    });
    expect(result).toEqual([]);
    expect(result).not.toContain("nominatim");
  });
});

