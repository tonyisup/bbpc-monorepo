"use client";

import { ConvexPredictionGame } from "@/components/ConvexPredictionGame";
import { ConvexQuotabungaSubmission } from "@/components/ConvexQuotabungaSubmission";
import { Button } from "@/components/ui/button";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import type { PredictionGameAssignment } from "@/types/prediction";
import { useEffect, useState } from "react";

interface GameParticipationProps {
  assignments: PredictionGameAssignment[];
  episodeStatus: string;
  searchQuery?: string;
}

export function GameParticipation({
  assignments,
  episodeStatus,
  searchQuery = "",
}: GameParticipationProps) {
  const [mounted, setMounted] = useState(false);
  const {
    accountIssue,
    accountStatus,
    refreshAccount,
    signIn,
    signOut,
    status,
    user,
  } = useBbpcAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || status === "loading") {
    return (
      <div
        className="h-24 animate-pulse rounded-lg bg-white/[0.04]"
        aria-label="Loading game"
      />
    );
  }

  if (!user) {
    return (
      <section className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-5 text-center">
        <h3 className="text-lg font-bold text-white">
          Make your picks and submit a quote
        </h3>
        <p className="mx-auto mt-1 max-w-lg text-sm text-zinc-300">
          One account unlocks both parts of this week&apos;s listener game.
        </p>
        <Button className="mt-4 whitespace-nowrap" onClick={signIn}>
          Sign in to play
        </Button>
      </section>
    );
  }

  if (accountStatus === "resolving") {
    return (
      <div
        className="mt-5 h-40 animate-pulse rounded-lg bg-white/[0.04]"
        aria-label="Resolving game account"
      />
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    const message =
      accountIssue === "account-disabled"
        ? "This account is disabled."
        : accountIssue === "identity-conflict"
          ? "This sign-in is already linked to another account."
          : accountIssue === "linking-disabled"
            ? "New account linking is paused in this environment."
            : accountIssue === "stale-client"
              ? "This page is out of date."
              : "Your game account could not be resolved.";

    return (
      <section className="mt-5 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-5 text-center">
        <h3 className="text-lg font-bold text-white">
          Game account needs attention
        </h3>
        <p className="mx-auto mt-1 max-w-lg text-sm text-zinc-300">
          {message}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={refreshAccount}>
            Try again
          </Button>
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      {assignments.length > 0 ? (
        <ConvexPredictionGame
          key={`${user.appUserId}:predictions`}
          assignments={assignments}
          searchQuery={searchQuery}
          episodeStatus={episodeStatus}
        />
      ) : null}
      <ConvexQuotabungaSubmission
        key={user.appUserId}
        isAdmin={user.isAdmin}
      />
    </div>
  );
}
