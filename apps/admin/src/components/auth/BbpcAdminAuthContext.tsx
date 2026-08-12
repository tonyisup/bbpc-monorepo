import { useClerk, useUser as useClerkUser } from "@clerk/nextjs";
import { useConvex, useConvexAuth } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type ConvexIdentityIssue,
  type ConvexIdentityProfile,
  getConvexIdentityIssue,
  resolveConvexIdentity,
} from "@/convex/identity";

export type BbpcAdminAuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated";
export type BbpcAdminAccountStatus =
  | "not-applicable"
  | "resolving"
  | "ready"
  | "action-required"
  | "unavailable";

export interface BbpcAdminAuthUser {
  appUserId: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  isAdmin: boolean;
}

export interface BbpcAdminAuthState {
  status: BbpcAdminAuthStatus;
  accountStatus: BbpcAdminAccountStatus;
  accountIssue: ConvexIdentityIssue | null;
  user: BbpcAdminAuthUser | null;
  signIn: () => void;
  signOut: () => void;
  refreshAccount: () => void;
}

const BbpcAdminAuthContext = createContext<BbpcAdminAuthState | null>(null);

export function useBbpcAdminAuth(): BbpcAdminAuthState {
  const value = useContext(BbpcAdminAuthContext);
  if (value === null) {
    throw new Error(
      "useBbpcAdminAuth must be used inside the BBPC admin providers."
    );
  }
  return value;
}

export function BbpcAdminAuthStateProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: BbpcAdminAuthState;
}) {
  return (
    <BbpcAdminAuthContext.Provider value={value}>
      {children}
    </BbpcAdminAuthContext.Provider>
  );
}

export function ClerkBbpcAdminAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useClerkUser();
  const convex = useConvex();
  const {
    isAuthenticated: isConvexAuthenticated,
    isLoading: isConvexAuthLoading,
  } = useConvexAuth();
  const [profile, setProfile] = useState<ConvexIdentityProfile | null>(null);
  const [accountIssue, setAccountIssue] = useState<ConvexIdentityIssue | null>(
    null
  );
  const [resolutionRevision, setResolutionRevision] = useState(0);
  const attemptedSessionRef = useRef<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const resolutionGenerationRef = useRef(0);
  const clerkUserId = user?.id ?? null;

  useEffect(() => {
    activeSessionRef.current = clerkUserId;
    if (!isLoaded || !isSignedIn || clerkUserId === null) {
      attemptedSessionRef.current = null;
      resolutionGenerationRef.current += 1;
      setProfile(null);
      setAccountIssue(null);
      return;
    }
    if (isConvexAuthLoading) {
      return;
    }
    if (!isConvexAuthenticated) {
      attemptedSessionRef.current = null;
      resolutionGenerationRef.current += 1;
      setProfile(null);
      setAccountIssue("unavailable");
      return;
    }

    // The Clerk subject is only a session-attempt key. Canonical ownership
    // and administrator capability always come from Convex.
    const attemptKey = clerkUserId;
    if (attemptedSessionRef.current === attemptKey) {
      return;
    }
    attemptedSessionRef.current = attemptKey;
    const resolutionGeneration = resolutionGenerationRef.current + 1;
    resolutionGenerationRef.current = resolutionGeneration;
    setProfile(null);
    setAccountIssue(null);

    void resolveConvexIdentity(convex)
      .then((resolvedProfile) => {
        if (
          activeSessionRef.current === attemptKey &&
          resolutionGenerationRef.current === resolutionGeneration
        ) {
          setProfile(resolvedProfile);
        }
      })
      .catch((error: unknown) => {
        if (
          activeSessionRef.current === attemptKey &&
          resolutionGenerationRef.current === resolutionGeneration
        ) {
          setAccountIssue(getConvexIdentityIssue(error));
        }
      });
  }, [
    clerkUserId,
    convex,
    isConvexAuthLoading,
    isConvexAuthenticated,
    isLoaded,
    isSignedIn,
    resolutionRevision,
  ]);

  const signIn = useCallback(() => {
    void clerk.redirectToSignIn({ redirectUrl: window.location.href });
  }, [clerk]);
  const signOut = useCallback(() => {
    void clerk.signOut({ redirectUrl: window.location.pathname });
  }, [clerk]);
  const refreshAccount = useCallback(() => {
    attemptedSessionRef.current = null;
    setResolutionRevision((revision) => revision + 1);
  }, []);

  const value = useMemo<BbpcAdminAuthState>(() => {
    const status: BbpcAdminAuthStatus =
      !isLoaded || (isSignedIn && isConvexAuthLoading)
        ? "loading"
        : isSignedIn
        ? "authenticated"
        : "unauthenticated";
    const hasActionRequiredIssue =
      accountIssue === "account-disabled" ||
      accountIssue === "identity-conflict";

    return {
      status,
      accountStatus: !isSignedIn
        ? "not-applicable"
        : profile !== null
        ? "ready"
        : accountIssue === null
        ? "resolving"
        : hasActionRequiredIssue
        ? "action-required"
        : "unavailable",
      accountIssue,
      user:
        isLoaded && isSignedIn
          ? {
              // A Clerk subject must never become an application-data ID.
              appUserId: profile?.id ?? null,
              name:
                profile?.name ??
                user.fullName ??
                user.username ??
                user.primaryEmailAddress?.emailAddress ??
                null,
              email:
                profile?.email ??
                user.primaryEmailAddress?.emailAddress ??
                null,
              image: profile?.image ?? user.imageUrl ?? null,
              isAdmin: profile?.isAdmin ?? false,
            }
          : null,
      signIn,
      signOut,
      refreshAccount,
    };
  }, [
    accountIssue,
    isConvexAuthLoading,
    isLoaded,
    isSignedIn,
    profile,
    refreshAccount,
    signIn,
    signOut,
    user,
  ]);

  return (
    <BbpcAdminAuthStateProvider value={value}>
      {children}
    </BbpcAdminAuthStateProvider>
  );
}
