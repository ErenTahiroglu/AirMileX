import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectAutocompleteProviders } from "./autocomplete-providers.ts";

describe("AirMileX Phase 5B: Part F Anonymous Autocomplete & Gateway Security", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("supabase/config.toml explicitly disables JWT verification for address-autocomplete", () => {
    const configPath = resolve(__dirname, "../../config.toml");
    const content = readFileSync(configPath, "utf8");

    // Must have [functions.address-autocomplete] with verify_jwt = false
    expect(content).toMatch(/\[functions\.address-autocomplete\]\s*\n\s*verify_jwt\s*=\s*false/);
  });

  it("preserves verify_jwt = false for paddle-webhook and quick-distance", () => {
    const configPath = resolve(__dirname, "../../config.toml");
    const content = readFileSync(configPath, "utf8");

    expect(content).toMatch(/\[functions\.paddle-webhook\]\s*\n\s*verify_jwt\s*=\s*false/);
    expect(content).toMatch(/\[functions\.quick-distance\]\s*\n\s*verify_jwt\s*=\s*false/);
  });

  it("allows anonymous landing-page users to select operator Geoapify within quota", async () => {
    const consumeQuota = vi.fn(async () => true);
    const providers = await selectAutocompleteProviders({
      userId: null, // anonymous user
      hasGeoapifyKey: true,
      consumeQuota,
    });

    expect(providers).toEqual(["geoapify"]);
    expect(consumeQuota).toHaveBeenCalledTimes(1);
  });

  it("enforces quotas for anonymous users and blocks provider selection when quota exhausted", async () => {
    const consumeQuota = vi.fn(async () => false);
    const providers = await selectAutocompleteProviders({
      userId: null,
      hasGeoapifyKey: true,
      consumeQuota,
    });

    expect(providers).toEqual([]);
    expect(consumeQuota).toHaveBeenCalledTimes(1);
  });

  it("never exposes the Geoapify API key in client responses or error logs", () => {
    const functionSrc = readFileSync(
      resolve(__dirname, "../address-autocomplete/index.ts"),
      "utf8"
    );

    // Assert endpoint does not include GEOAPIFY_KEY in json response payloads
    expect(functionSrc).not.toContain("GEOAPIFY_KEY: GEOAPIFY_KEY");
    expect(functionSrc).not.toContain("apiKey: GEOAPIFY_KEY");
    expect(functionSrc).not.toContain("key: GEOAPIFY_KEY");
    // Verify response structure returns suggestions and providers only
    expect(functionSrc).toContain("return json({ suggestions: suggestions.filter((s) => s.label).slice(0, 5), providers });");
  });

  it("enforces input bounds: queries under 3 characters return empty without querying provider", () => {
    const functionSrc = readFileSync(
      resolve(__dirname, "../address-autocomplete/index.ts"),
      "utf8"
    );
    expect(functionSrc).toContain('if (typeof query !== "string" || query.trim().length < 3)');
    expect(functionSrc).toContain("return json({ suggestions: [] });");
  });

  it("enforces input bounds: queries over 200 characters return 400 error", () => {
    const functionSrc = readFileSync(
      resolve(__dirname, "../address-autocomplete/index.ts"),
      "utf8"
    );
    expect(functionSrc).toContain("if (query.length > 200)");
    expect(functionSrc).toContain('return json({ error: "Search text is too long." }, 400);');
  });

  it("preserves origin checks via isTrustedRequest", () => {
    const functionSrc = readFileSync(
      resolve(__dirname, "../address-autocomplete/index.ts"),
      "utf8"
    );
    expect(functionSrc).toContain("if (!isTrustedRequest(req))");
    expect(functionSrc).toContain('return json({ error: "Requests from this origin are not allowed." }, 403);');
  });
});
