"use client";

import { ConvexPredictionGame } from "@/components/ConvexPredictionGame";
import { ConvexQuotabungaSubmission } from "@/components/ConvexQuotabungaSubmission";
import {
  GameSheet,
  GameSheetHeader,
  GameSheetRow,
} from "@/components/GameSheet";
import { Button } from "@/components/ui/button";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import type { PredictionGameAssignment } from "@/types/prediction";
import { useEffect, useState } from "react";

interface GameParticipationProps {
  episodeId: string;
  assignments: PredictionGameAssignment[];
  episodeStatus: string;
  searchQuery?: string;
}

export function GameParticipation({
  episodeId,
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
      <GameSheet className="mt-5" aria-label="Listener game">
        <GameSheetHeader title="Make your picks and submit a quote" />
        <GameSheetRow className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-zinc-300">
            One account covers your picks, wagers and Quotabunga quote.
          </p>
          <Button
            className="min-h-11 w-full whitespace-nowrap sm:w-auto"
            onClick={signIn}
          >
            Sign in to play
          </Button>
        </GameSheetRow>
      </GameSheet>
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
      <GameSheet className="mt-5" aria-label="Listener game">
        <GameSheetHeader title="Game account needs attention" />
        <GameSheetRow className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-zinc-300">{message}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refreshAccount}>
              Try again
            </Button>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </GameSheetRow>
      </GameSheet>
    );
  }

  // Quotabunga is the last row of the game's sheet, and a sheet of its own
  // when the episode has no movies to rate.
  return (
    <div className="mt-5">
      {assignments.length > 0 ? (
        <ConvexPredictionGame
          episodeId={episodeId}
          key={`${user.appUserId}:predictions`}
          assignments={assignments}
          searchQuery={searchQuery}
          episodeStatus={episodeStatus}
        >
          <ConvexQuotabungaSubmission
            key={`${user.appUserId}:${episodeId}`}
            isAdmin={user.isAdmin}
            episodeId={episodeId}
            episodeStatus={episodeStatus}
          />
        </ConvexPredictionGame>
      ) : (
        <GameSheet aria-label="Listener game">
          <ConvexQuotabungaSubmission
            key={`${user.appUserId}:${episodeId}`}
            isAdmin={user.isAdmin}
            episodeId={episodeId}
            episodeStatus={episodeStatus}
          />
        </GameSheet>
      )}
    </div>
  );
}
