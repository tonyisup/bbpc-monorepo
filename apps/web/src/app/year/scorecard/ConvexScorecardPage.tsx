"use client";

import { Lock } from "lucide-react";
import Link from "next/link";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import SignOutButton from "@/components/SignOutButton";
import { Button } from "@/components/ui/button";

import { ScorecardManager } from "./ScorecardManager";

export function ConvexScorecardPage() {
  const { accountStatus, refreshAccount, signIn, status, user } = useBbpcAuth();

  if (status === "loading" || accountStatus === "resolving") {
    return <LoadingIndicator variant="page" label="Loading scorecard" />;
  }

  if (status === "unauthenticated" || user === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Sign in to use your scorecard</h1>
        <p className="mt-2 max-w-md text-muted-foreground">
          Score this year&apos;s movies on nine criteria to build your top 10.
          Your scores are private to you.
        </p>
        <Button className="mt-6" onClick={signIn}>
          Sign in
        </Button>
      </div>
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Scorecard unavailable</h1>
        <p className="mt-4 max-w-lg text-muted-foreground">
          Your BBPC account could not be resolved for this private page.
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
    <div className="bbpc-page w-full max-w-4xl space-y-4 pt-4 sm:space-y-6 sm:pt-12">
      <header>
        <p className="bbpc-kicker">
          <Link href="/year" className="hover:underline">
            Year in review
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-4xl">
          My Scorecard
        </h1>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground sm:mt-2 sm:text-sm">
          <Lock className="h-3.5 w-3.5" /> Private to you. Score each movie to
          find your top 10.
        </p>
      </header>
      <ScorecardManager
        appUserId={user.appUserId}
        canUseRankedLists={user.isAdmin}
      />
    </div>
  );
}
