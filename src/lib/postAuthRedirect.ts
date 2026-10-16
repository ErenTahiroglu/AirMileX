const STORAGE_KEY = "postAuthRedirect";

/**
 * Validates that a path is a safe same-origin relative destination.
 *
 * Strict requirements:
 * - Must start with "/"
 * - Must NOT start with "//" or "/\" (protocol-relative)
 * - Must NOT contain backslashes anywhere ("\", "%5c", "%5C")
 * - Must NOT contain ASCII control characters or unprintable characters (0x00-0x1F, 0x7F)
 * - Must NOT specify an external scheme or host
 */
export const isSafeRelativePath = (path: string | null | undefined): path is string => {
  if (!path || typeof path !== "string") return false;

  const trimmed = path.trim();
  if (trimmed !== path || path.length === 0) return false;

  // Must begin with a single "/"
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return false;
  }

  // Reject any backslashes in the raw path
  if (path.includes("\\")) {
    return false;
  }

  // Reject ASCII control characters in the raw path
  if (/[\u0000-\u001F\u007F]/.test(path)) {
    return false;
  }

  // Reject external URI scheme prefixes like javascript:, data:, vbscript:, http:, https:
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    return false;
  }

  // Check URL-decoded representation to prevent encoding bypasses (e.g. %2F%2F, %5C, %00)
  try {
    const decoded = decodeURIComponent(path);
    if (
      decoded.startsWith("//") ||
      decoded.startsWith("/\\") ||
      decoded.includes("\\") ||
      /[\u0000-\u001F\u007F]/.test(decoded)
    ) {
      return false;
    }
  } catch {
    // Malformed URI sequence
    return false;
  }

  // Verify hostname and origin isolation using URL parser with a dummy base origin
  try {
    const parsed = new URL(path, "https://airmilex.local");
    if (parsed.origin !== "https://airmilex.local") {
      return false;
    }
    if (parsed.protocol !== "https:" || !parsed.pathname.startsWith("/")) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
};

/**
 * Stores destination in both sessionStorage and localStorage so that:
 * 1. Standard email/password logins survive in current tab
 * 2. Cross-tab email confirmation links on the same origin/browser can retrieve the intended path
 * 3. OAuth redirects to Google that reload the window survive
 */
export const storePostAuthRedirect = (path: string | null | undefined) => {
  if (!isSafeRelativePath(path)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // storage restricted
  }
  try {
    localStorage.setItem(STORAGE_KEY, path);
  } catch {
    // storage restricted
  }
};

/**
 * Consumes and clears the stored post-auth destination.
 * Checks sessionStorage first, falls back to localStorage (for new confirmation tabs),
 * and cleans up both.
 */
export const consumePostAuthRedirect = (): string | null => {
  let path: string | null = null;
  try {
    path = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage restricted
  }

  if (!path) {
    try {
      path = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage restricted
    }
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage restricted
  }

  return isSafeRelativePath(path) ? path : null;
};
