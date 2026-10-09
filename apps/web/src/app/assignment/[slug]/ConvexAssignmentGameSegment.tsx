"use client";

import { ConvexPredictionGame } from "@/components/ConvexPredictionGame";
import {
  GameSheet,
  GameSheetHeader,
  GameSheetRow,
} from "@/components/GameSheet";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";
import type { ConvexPublicAssignment } from "@/server/convex/assignments";

function accountErrorMessage(
  issue: ReturnType<typeof useBbpcAuth>["accountIssue"]
) {
  switch (issue) {
    case "account-disabled":
      return "This account is disabled.";
    case "identity-conflict":
      return "This sign-in is already linked to another account.";
    case "linking-disabled":
      return "New account linking is paused in this environment.";
    case "stale-client":
      return "This page is out of date.";
    default:
      return "Your game account could not be resolved.";
  }
}

export function ConvexAssignmentGameSegment({
  assignment,
}: {
  assignment: ConvexPublicAssignment;
}) {
  const {
    accountIssue,
    accountStatus,
    refreshAccount,
    signIn,
    signOut,
    status,
    user,
  } = useBbpcAuth();

  if (status === "loading" || accountStatus === "resolving") {
    return (
      <div
        className="h-56 w-full max-w-4xl animate-pulse rounded-xl bg-white/[0.04]"
        aria-label="Loading assignment game"
      />
    );
  }

  if (status === "unauthenticated" || user === null) {
    return (
      <GameSheet className="w-full max-w-4xl" aria-label="Listener game">
        <GameSheetHeader title="Guess the hosts’ ratings" />
        <GameSheetRow className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-zinc-300">
            Sign in to predict the hosts&apos; ratings and optionally wager
            points.
          </p>
          <Button className="min-h-11 w-full sm:w-auto" onClick={signIn}>
            Sign in to play
          </Button>
        </GameSheetRow>
      </GameSheet>
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    return (
      <GameSheet className="w-full max-w-4xl" aria-label="Listener game">
        <GameSheetHeader title="Game account needs attention" />
        <GameSheetRow className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-zinc-300">{accountErrorMessage(accountIssue)}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={refreshAccount}
            >
              Try again
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </GameSheetRow>
      </GameSheet>
    );
  }

  return (
    <div className="w-full max-w-4xl">
      <ConvexPredictionGame
        episodeId={assignment.episode.id}
        key={`${user.appUserId}:${assignment.id}`}
        assignments={[
          {
            id: assignment.id,
            playable: assignment.playable,
            movie: {
              title: assignment.movie.title,
              poster: assignment.movie.poster,
            },
          },
        ]}
        episodeStatus={assignment.episode.status ?? ""}
      />
    </div>
  );
}
