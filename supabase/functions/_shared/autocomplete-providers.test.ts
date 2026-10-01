import { describe, expect, it, vi } from "vitest";
import { selectAutocompleteProviders } from "./autocomplete-providers.ts";

const base = { hasGeoapifyKey: true, hasOrsKey: true };

describe("selectAutocompleteProviders", () => {
  it("anonymous searches use only Nominatim and never touch paid quota", async () => {
    const consumePaidQuota = vi.fn(async () => true);
    const result = await selectAutocompleteProviders({ ...base, userId: null, consumePaidQuota });
    expect(result).toEqual(["nominatim"]);
    expect(consumePaidQuota).not.toHaveBeenCalled();
  });

  it("signed-in searches can use paid providers first, with Nominatim as fallback", async () => {
    const result = await selectAutocompleteProviders({
      ...base,
      userId: "user-1",
      consumePaidQuota: async () => true,
    });
    expect(result).toEqual(["geoapify", "ors", "nominatim"]);
  });

  it("signed-in searches fall back to Nominatim when paid quota is exhausted", async () => {
    const result = await selectAutocompleteProviders({
      ...base,
      userId: "user-1",
      consumePaidQuota: async () => false,
    });
    expect(result).toEqual(["nominatim"]);
  });

  it("only includes paid providers whose keys are configured", async () => {
    const result = await selectAutocompleteProviders({
      userId: "user-1",
      hasGeoapifyKey: false,
      hasOrsKey: true,
      consumePaidQuota: async () => true,
    });
    expect(result).toEqual(["ors", "nominatim"]);
  });
});
