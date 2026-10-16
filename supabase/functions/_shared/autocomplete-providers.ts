/**
 * Decides which address-suggestion providers a request may use.
 * Standardizes exclusively on operator-managed Geoapify for both anonymous
 * (landing page) and signed-in users within quota.
 * Public Nominatim and ORS are completely removed.
 */
export type AutocompleteProvider = "geoapify";

export interface AutocompleteProviderInput {
  userId?: string | null;
  hasGeoapifyKey: boolean;
  /** Lazily checks (and consumes) rate/usage quota; only called when Geoapify key is configured. */
  consumeQuota?: () => Promise<boolean>;
}

export async function selectAutocompleteProviders(
  input: AutocompleteProviderInput
): Promise<AutocompleteProvider[]> {
  if (!input.hasGeoapifyKey) {
    return [];
  }
  if (input.consumeQuota) {
    const allowed = await input.consumeQuota();
    if (!allowed) return [];
  }
  return ["geoapify"];
}

