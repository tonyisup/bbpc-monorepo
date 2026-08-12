"use client";

import { ConvexPredictionGame } from "@/components/ConvexPredictionGame";
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
      <section className="w-full max-w-4xl rounded-xl border border-red-500/20 bg-red-500/[0.06] p-5 text-center">
        <h2 className="text-xl font-bold text-white">Submit your guesses</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-300">
          Sign in to predict the hosts&apos; ratings and optionally wager
          points.
        </p>
        <Button className="mt-4" onClick={signIn}>
          Sign in to play
        </Button>
      </section>
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    return (
      <section className="w-full max-w-4xl rounded-xl border border-red-500/20 bg-red-500/[0.06] p-5 text-center">
        <h2 className="text-xl font-bold text-white">
          Game account needs attention
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-300">
          {accountErrorMessage(accountIssue)}
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
    <section className="w-full max-w-4xl space-y-4">
      <div>
        <p className="bbpc-kicker">Listener game</p>
        <h2 className="text-2xl font-black text-white">Submit your guesses</h2>
      </div>
      <ConvexPredictionGame
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
    </section>
  );
}
