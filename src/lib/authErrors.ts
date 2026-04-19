/**
 * Maps Supabase auth errors into friendly, user-readable messages.
 * Special-cases rate limit errors and HIBP (pwned password) responses.
 */
export interface FriendlyAuthError {
  title: string;
  description: string;
}

export const friendlyAuthError = (error: unknown): FriendlyAuthError => {
  const err = error as { message?: string; status?: number; code?: string } | null;
  const raw = (err?.message ?? "").toLowerCase();
  const status = err?.status;
  const code = (err?.code ?? "").toLowerCase();

  // Rate limiting
  if (
    status === 429 ||
    code.includes("rate") ||
    raw.includes("rate limit") ||
    raw.includes("too many") ||
    raw.includes("for security purposes") // Supabase email-rate phrasing
  ) {
    // Try to extract a "after X seconds" hint
    const seconds = raw.match(/(\d+)\s*seconds?/);
    return {
      title: "Slow down a moment",
      description: seconds
        ? `Too many attempts. Please wait ${seconds[1]} seconds and try again.`
        : "You've made too many requests. Please wait a minute and try again.",
    };
  }

  // HIBP / weak password
  if (
    raw.includes("pwned") ||
    raw.includes("compromised") ||
    raw.includes("weak_password") ||
    code.includes("weak_password")
  ) {
    return {
      title: "Choose a stronger password",
      description:
        "This password has appeared in a known data breach. Please pick a different, stronger password.",
    };
  }

  // Invalid credentials
  if (raw.includes("invalid login") || raw.includes("invalid credentials")) {
    return {
      title: "Sign-in failed",
      description: "The email or password you entered is incorrect.",
    };
  }

  // Already registered
  if (raw.includes("already registered") || raw.includes("user already")) {
    return {
      title: "Account already exists",
      description: "An account with this email already exists. Try signing in instead.",
    };
  }

  // Email not confirmed
  if (raw.includes("email not confirmed")) {
    return {
      title: "Confirm your email",
      description: "Please check your inbox and click the confirmation link before signing in.",
    };
  }

  return {
    title: "Something went wrong",
    description: err?.message || "Please try again in a moment.",
  };
};
