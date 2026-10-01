/**
 * Decides which address-suggestion providers a request may use.
 * Paid providers (Geoapify, OpenRouteService) are only for verified signed-in
 * users within quota; everyone else gets the free Nominatim provider.
 * Pure function so it can be unit-tested without network or Deno APIs.
 */
export type AutocompleteProvider = "geoapify" | "ors" | "nominatim";

export interface AutocompleteProviderInput {
  userId: string | null;
  hasGeoapifyKey: boolean;
  hasOrsKey: boolean;
  /** Lazily checks (and consumes) paid quota; only called when paid use is possible. */
  consumePaidQuota: () => Promise<boolean>;
}

export async function selectAutocompleteProviders(
  input: AutocompleteProviderInput
): Promise<AutocompleteProvider[]> {
  const providers: AutocompleteProvider[] = [];
  const paidPossible = Boolean(input.userId) && (input.hasGeoapifyKey || input.hasOrsKey);
  if (paidPossible && (await input.consumePaidQuota())) {
    if (input.hasGeoapifyKey) providers.push("geoapify");
    if (input.hasOrsKey) providers.push("ors");
  }
  providers.push("nominatim");
  return providers;
}
