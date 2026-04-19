import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const WARNING_BEFORE_MS = 5 * 60 * 1000; // 5 minutes before expiry (temporary, for testing)

/**
 * Watches the auth session and shows a warning toast 1 minute before it expires,
 * with a "Stay signed in" action that refreshes the session.
 */
export const SessionTimeoutWatcher = () => {
  const { session } = useAuth();
  const warningTimerRef = useRef<number | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const shownForRef = useRef<number | null>(null);

  useEffect(() => {
    // Clear any existing timers when session changes
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
    if (expiryTimerRef.current) window.clearTimeout(expiryTimerRef.current);

    if (!session?.expires_at) return;

    const expiresAtMs = session.expires_at * 1000;
    const now = Date.now();
    const msUntilWarning = expiresAtMs - now - WARNING_BEFORE_MS;
    const msUntilExpiry = expiresAtMs - now;

    // Don't re-toast for the same session expiry we've already warned about
    if (shownForRef.current === session.expires_at) return;

    if (msUntilWarning > 0) {
      warningTimerRef.current = window.setTimeout(() => {
        shownForRef.current = session.expires_at ?? null;
        toast.warning("Your session expires in 5 minutes", {
          description: "Stay signed in to keep working without interruption.",
          duration: 60_000,
          action: {
            label: "Stay signed in",
            onClick: async () => {
              const { error } = await supabase.auth.refreshSession();
              if (error) {
                toast.error("Could not refresh session", { description: error.message });
              } else {
                toast.success("Session refreshed");
              }
            },
          },
        });
      }, msUntilWarning);
    }

    if (msUntilExpiry > 0) {
      expiryTimerRef.current = window.setTimeout(() => {
        toast.error("Your session has expired", {
          description: "Please sign in again to continue.",
        });
      }, msUntilExpiry);
    }

    return () => {
      if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
      if (expiryTimerRef.current) window.clearTimeout(expiryTimerRef.current);
    };
  }, [session?.expires_at, session?.access_token]);

  return null;
};
