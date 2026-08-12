"use client";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import SignOutButton from "@/components/SignOutButton";
import { Button } from "@/components/ui/button";

import { ConvexProfileForm } from "./ConvexProfileForm";
import { ConvexProfileSummary } from "./ConvexProfileSummary";
import { ConvexPointHistory } from "./ConvexPointHistory";

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

export function ConvexProfilePage() {
  const { accountIssue, accountStatus, refreshAccount, signIn, status, user } =
    useBbpcAuth();

  if (status === "loading" || accountStatus === "resolving") {
    return (
      <div
        className="container min-h-[50vh] animate-pulse px-4 py-16"
        aria-label="Loading profile"
      />
    );
  }

  if (status === "unauthenticated" || user === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Sign in to view your profile</h1>
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

  return (
    <div className="container flex flex-col items-start justify-center gap-12 px-4 py-16">
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
        {user.email ?? user.name ?? "Profile"}
      </h1>

      <ConvexProfileForm
        initialName={user.name ?? ""}
        initialImage={user.image}
      />

      <ConvexProfileSummary appUserId={user.appUserId} />
      <ConvexPointHistory appUserId={user.appUserId} />

      <SignOutButton />
    </div>
  );
}
