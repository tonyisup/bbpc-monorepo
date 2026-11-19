"use client";

import { useConvex } from "convex/react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { loadCurrentConvexImpersonation } from "@/convex/impersonation";
import {
  identifyAnalyticsUser,
  isAnalyticsUserIdentified,
  resetAnalytics,
  setAnalyticsClient,
} from "@/lib/analytics";

// Initialize when this client-only module loads, before anything renders.
// Initializing inside an effect lost the landing pageview: child effects run
// before parent effects, so the first capture reached an uninitialized SDK.
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (typeof window !== "undefined" && posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    // Captures the landing pageview and each client-side route change, and
    // turns $pageleave back on for bounce rate and session duration.
    defaults: "2026-01-30",
    person_profiles: "identified_only",
    capture_exceptions: true,
  });
  setAnalyticsClient(posthog);
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <PostHogIdentity />
      {children}
    </PHProvider>
  );
}

/**
 * Identify signed-in listeners by their canonical Convex user ID, and unlink
 * the browser once they are signed out.
 */
function PostHogIdentity() {
  const convex = useConvex();
  const { status, accountStatus, user } = useBbpcAuth();
  const appUserId = user?.appUserId ?? null;
  const isAdmin = user?.isAdmin ?? false;
  const isHost = user?.isHost ?? false;

  useEffect(() => {
    if (status === "unauthenticated") {
      if (isAnalyticsUserIdentified()) {
        resetAnalytics();
      }
      return;
    }
    if (status !== "authenticated" || accountStatus !== "ready" || appUserId === null) {
      return;
    }
    let cancelled = false;
    // While an admin impersonates a listener, the profile is the listener's.
    // Identifying then would merge the admin into that listener's person, so
    // identify only when no impersonation session is active. The check
    // returns null for non-admins; on failure we skip and retry next change.
    void loadCurrentConvexImpersonation(convex)
      .then((session) => {
        if (!cancelled && session === null) {
          identifyAnalyticsUser({ appUserId, isAdmin, isHost });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountStatus, appUserId, convex, isAdmin, isHost, status]);

  return null;
}
