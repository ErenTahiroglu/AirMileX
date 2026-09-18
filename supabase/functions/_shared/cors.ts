/**
 * Shared CORS handling with an origin allowlist.
 * Public endpoints must only answer calls coming from our own front-ends.
 */

const ALLOWED_HOST_SUFFIXES = [".lovable.app", ".lovableproject.com"];
const ALLOWED_HOSTS = ["localhost", "127.0.0.1", "airmilex.lovable.app"];

const ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

export const isAllowedOrigin = (origin: string | null): boolean => {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return (
      ALLOWED_HOSTS.includes(hostname) ||
      ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
};

/** CORS headers echoing the caller's origin only when it is allowlisted. */
export const buildCorsHeaders = (req: Request): Record<string, string> => {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin! : "null",
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};

/**
 * Verifies that a browser request comes from an allowed site.
 * Origin is authoritative; Referer is used when Origin is absent.
 */
export const isTrustedRequest = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  if (origin) return isAllowedOrigin(origin);

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return isAllowedOrigin(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
};
