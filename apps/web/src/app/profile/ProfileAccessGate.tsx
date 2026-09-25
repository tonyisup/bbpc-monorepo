"use client";

import type { ReactNode } from "react";

import {
  type BbpcAuthUser,
  useBbpcAuth,
} from "@/components/auth/BbpcAuthContext";
import SignOutButton from "@/components/SignOutButton";
import { Button } from "@/components/ui/button";

export type ProfileAccessUser = BbpcAuthUser & { appUserId: string };

function accountMessage(
  issue: ReturnType<typeof useBbpcAuth>["accountIssue"]
): string {
  switch (issue) {
    case "account-disabled":
      return "This BBPC account is disabled. Ask an administrator for help.";
    case "identity-conflict":
      return "This sign-in matches an account that needs administrator review.";
    case "linking-disabled":
      return "Account linking is paused while this environment is read-only.";
    case "stale-client":
      return "This page is out of date. Refresh it and try again.";
    default:
      return "Your BBPC account could not be resolved. Please try again.";
  }
}

const widthClass = { "4xl": "max-w-4xl", "5xl": "max-w-5xl" } as const;

/**
 * The loading, sign-in, and unavailable-account states every member page
 * shares. Children render only for a resolved, linked account.
 */
export function ProfileAccessGate({
  label,
  width = "4xl",
  children,
}: {
  label: string;
  /** Matches the loaded page's column so the skeleton doesn't jump. */
  width?: keyof typeof widthClass;
  children: (user: ProfileAccessUser) => ReactNode;
}) {
  const { accountIssue, accountStatus, refreshAccount, signIn, status, user } =
    useBbpcAuth();

  if (status === "loading" || accountStatus === "resolving") {
    return (
      <div className={`bbpc-page ${widthClass[width]}`}>
        <div
          className="h-40 animate-pulse rounded-lg bg-white/[0.04]"
          aria-label={`Loading ${label}`}
        />
      </div>
    );
  }

  if (status === "unauthenticated" || user === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{`Sign in to view your ${label}`}</h1>
        <Button className="mt-6" onClick={signIn}>
          Sign in
        </Button>
      </div>
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Account unavailable</h1>
        <p className="mt-4 max-w-lg text-muted-foreground">
          {accountMessage(accountIssue)}
        </p>
        <div className="mt-8 flex gap-3">
          <Button variant="outline" onClick={refreshAccount}>
            Try again
          </Button>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return <>{children({ ...user, appUserId: user.appUserId })}</>;
}
