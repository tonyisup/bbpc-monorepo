import { useConvex } from "convex/react";
import {
  ArrowUpRight,
  CalendarRange,
  Coins,
  Loader2,
  Quote,
  RefreshCw,
  Target,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  ConvexAssignmentWagerStatus,
  ConvexAssignmentWorkbench,
} from "@/convex/assignmentDetails";
import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";
import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";
import { formatPlainDate, getPacificTodayPlainDate } from "@/lib/dates";
import {
  getAdminAssignmentPath,
  getAdminQuotabungaEpisodePath,
} from "@/lib/routes";

import {
  HIDDEN_NAME,
  ListenerNamesToggle,
  listenerName,
  useListenerNames,
} from "../Quotabunga/ListenerNames";
import { SeasonPositionBadges } from "../Recording/SeasonPositionBadges";
import RatingIcon from "../Review/RatingIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { type EpisodeResults, loadEpisodeResults } from "./episodeResultsModel";

export type EpisodeResultsState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; results: EpisodeResults };

/**
 * Loads the episode's season and game results once the episode has loaded;
 * `revision` forces a reload.
 */
export function useEpisodeResults(
  episode: ConvexAdminEpisodeDetail | null,
  revision: number
): EpisodeResultsState {
  const convex = useConvex();
  const [state, setState] = useState<EpisodeResultsState>({
    status: "loading",
  });
  const id = episode?.id ?? null;
  const number = episode?.number ?? 0;
  const date = episode?.date ?? null;
  const assignmentKey =
    episode?.assignments.map((assignment) => assignment.id).join(",") ?? "";

  useEffect(() => {
    if (id === null) {
      return;
    }
    let active = true;
    setState({ status: "loading" });
    const assignments = assignmentKey
      .split(",")
      .filter(Boolean)
      .map((assignmentId) => ({ id: assignmentId }));
    void loadEpisodeResults(
      convex,
      { id, number, date, assignments },
      getPacificTodayPlainDate()
    )
      .then((results) => {
        if (active) setState({ status: "ready", results });
      })
      .catch((error: unknown) => {
        console.error("Episode results could not be loaded.", error);
        if (active) setState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [assignmentKey, convex, date, id, number, revision]);

  return state;
}

/** The episode's season, for the page header. */
export function EpisodeSeasonBadges({ state }: { state: EpisodeResultsState }) {
  if (state.status !== "ready") {
    return null;
  }
  const { season, seasonPosition } = state.results;
  if (season === null) {
    return <Badge variant="outline">No season</Badge>;
  }
  return seasonPosition === null ? (
    <Badge variant="outline">{season.title}</Badge>
  ) : (
    <SeasonPositionBadges position={seasonPosition} season={season} />
  );
}

function seasonRange(season: EpisodeResults["season"]): string {
  if (season === null || season.startedOn === null) {
    return "No start date";
  }
  const started = formatPlainDate(season.startedOn, { dateStyle: "medium" });
  return season.endedOn === null
    ? `${started} – ongoing`
    : `${started} – ${formatPlainDate(season.endedOn, {
        dateStyle: "medium",
      })}`;
}

function SeasonCard({
  episode,
  results,
}: {
  episode: ConvexAdminEpisodeDetail;
  results: EpisodeResults;
}) {
  const { season, seasonPosition } = results;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Season
          </CardTitle>
          <CardDescription>
            An episode belongs to the season whose dates include its date.
          </CardDescription>
        </div>
        {season !== null && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/season/${encodeURIComponent(season.id)}`}>
              Open season <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {season === null ? (
          <p className="text-sm text-muted-foreground">
            {episode.date === null
              ? "No season is running today, and this episode has no date."
              : "No season covers this episode's date."}
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xl font-black">{season.title}</p>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarRange className="h-4 w-4" />
                {seasonRange(season)} · {season.gameType.title}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SeasonPositionBadges position={seasonPosition} season={season} />
            </div>
            {episode.date === null && (
              <p className="text-xs text-muted-foreground">
                This episode has no date, so it is placed in the season running
                today.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuotabungaCard({
  episodeId,
  quotes,
}: {
  episodeId: string;
  quotes: ConvexAdminQuoteSubmission[];
}) {
  const names = useListenerNames(quotes, episodeId);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Quote className="h-5 w-5" />
            Quotabunga ({quotes.length})
          </CardTitle>
          <CardDescription>
            Placed entries first. Listener names stay hidden until points are
            awarded.
          </CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <ListenerNamesToggle
            awarded={names.awarded}
            onPeekingChange={names.setPeeking}
            peeking={names.peeking}
          />
          <Button asChild size="sm" variant="outline">
            <Link href={getAdminQuotabungaEpisodePath(episodeId)}>
              Open Quotabunga <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No quotes were submitted for this episode.
          </p>
        ) : (
          quotes.map((quote) => (
            <div className="space-y-2 rounded-lg border p-4" key={quote.id}>
              <div className="flex flex-wrap items-center gap-2">
                {quote.placement !== null && (
                  <Badge>
                    Place #{quote.placement} · {quote.point?.adjustment ?? 0}{" "}
                    points
                  </Badge>
                )}
                <Badge
                  variant={
                    quote.status === "REJECTED" ? "outline" : "secondary"
                  }
                >
                  {quote.status}
                </Badge>
                <span
                  className={
                    names.shown
                      ? "text-sm font-semibold"
                      : "text-sm font-semibold text-muted-foreground"
                  }
                >
                  {names.shown ? listenerName(quote) : HIDDEN_NAME}
                </span>
              </div>
              <blockquote className="border-l-2 pl-3 italic">
                “{quote.quoteText}”
              </blockquote>
              <p className="text-xs text-muted-foreground">
                {quote.sourceTitle} · {quote.sourceType}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AssignmentHeading({
  assignment,
}: {
  assignment: ConvexAssignmentWorkbench["assignment"];
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-black">
          {assignment.movie.title} ({assignment.movie.year})
        </p>
        <p className="text-xs text-muted-foreground">
          {assignment.type.replaceAll("_", " ")} · assigned by{" "}
          {assignment.user.name ?? "Unknown"}
        </p>
      </div>
      {assignment.slug !== null && (
        <Button asChild size="sm" variant="ghost">
          <Link href={getAdminAssignmentPath(assignment.slug)}>
            Manage <ArrowUpRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      )}
    </div>
  );
}

function GuessResultsCard({
  workbenches,
}: {
  workbenches: ConvexAssignmentWorkbench[];
}) {
  const guessCount = workbenches.reduce(
    (sum, { reviews }) =>
      sum + reviews.reduce((count, { guesses }) => count + guesses.length, 0),
    0
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Game results ({guessCount} guesses)
        </CardTitle>
        <CardDescription>
          Each host&apos;s rating against the listeners&apos; guesses for it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {workbenches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This episode has no assignments.
          </p>
        ) : (
          workbenches.map(({ assignment, reviews }) => (
            <section className="space-y-3" key={assignment.id}>
              <AssignmentHeading assignment={assignment} />
              {reviews.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No host reviews are attached to this assignment.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {reviews.map((review) => (
                    <div className="rounded-lg border" key={review.id}>
                      <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2">
                        <p className="font-bold">
                          {review.reviewer?.name ?? "Unknown host"}
                        </p>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {review.rating === null ? (
                            "Not rated"
                          ) : (
                            <>
                              <RatingIcon value={review.rating.value} />
                              {review.rating.name}
                            </>
                          )}
                        </span>
                      </div>
                      {review.guesses.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">
                          No guesses.
                        </p>
                      ) : (
                        <div className="divide-y">
                          {review.guesses.map((guess) => (
                            <div
                              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                              key={guess.id}
                            >
                              <span className="flex items-center gap-2">
                                <RatingIcon value={guess.rating.value} />
                                <span className="font-medium">
                                  {guess.user.name ?? "Unnamed listener"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  guessed {guess.rating.name}
                                </span>
                              </span>
                              <span className="flex items-center gap-2">
                                {review.rating !== null && (
                                  <Badge
                                    variant={
                                      guess.rating.id === review.rating.id
                                        ? "default"
                                        : "outline"
                                    }
                                  >
                                    {guess.rating.id === review.rating.id
                                      ? "Correct"
                                      : "Wrong"}
                                  </Badge>
                                )}
                                {guess.hasPoint && (
                                  <Badge variant="secondary">Awarded</Badge>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function wagerStatusClass(status: ConvexAssignmentWagerStatus): string {
  switch (status) {
    case "won":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
    case "lost":
    case "rejected":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "locked":
      return "border-blue-500/20 bg-blue-500/10 text-blue-700";
    case "pending":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700";
  }
}

function WagerResultsCard({
  workbenches,
}: {
  workbenches: ConvexAssignmentWorkbench[];
}) {
  const wagered = workbenches.filter(({ wagers }) => wagers.length > 0);
  const wagerCount = wagered.reduce(
    (sum, { wagers }) => sum + wagers.length,
    0
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Wagers ({wagerCount})
        </CardTitle>
        <CardDescription>
          Wagers placed on this episode&apos;s assignments and how they
          resolved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {wagered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No wagers were placed on this episode.
          </p>
        ) : (
          wagered.map(({ assignment, wagers }) => (
            <section className="space-y-3" key={assignment.id}>
              <AssignmentHeading assignment={assignment} />
              {wagers.map((wager) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  key={wager.id}
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {wager.user.name ?? "Unnamed listener"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {wager.points} points × {wager.gamblingType.multiplier} ·{" "}
                      {wager.gamblingType.title}
                      {wager.targetUser === null
                        ? ""
                        : ` · target ${
                            wager.targetUser.name ?? "Unnamed user"
                          }`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className={wagerStatusClass(wager.status)}
                      variant="outline"
                    >
                      {wager.status}
                    </Badge>
                    {wager.awardAdjustment !== null && (
                      <Badge variant="secondary">
                        {wager.awardAdjustment > 0 ? "+" : ""}
                        {wager.awardAdjustment} pts
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function EpisodeResultsPanel({
  episode,
  onRetry,
  state,
}: {
  episode: ConvexAdminEpisodeDetail;
  onRetry: () => void;
  state: EpisodeResultsState;
}) {
  if (state.status === "loading") {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          The season and results could not be loaded.
        </p>
        <Button className="gap-2" onClick={onRetry} variant="outline">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }
  const { results } = state;
  return (
    <div className="space-y-8">
      <SeasonCard episode={episode} results={results} />
      <QuotabungaCard episodeId={episode.id} quotes={results.quotes} />
      <GuessResultsCard workbenches={results.workbenches} />
      <WagerResultsCard workbenches={results.workbenches} />
    </div>
  );
}
