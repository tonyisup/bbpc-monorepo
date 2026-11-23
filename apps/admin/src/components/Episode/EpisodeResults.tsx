import { useConvex } from "convex/react";
import {
  ArrowUpRight,
  CalendarRange,
  Coins,
  Loader2,
  Quote,
  RefreshCw,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAssignmentGuess,
  type ConvexAssignmentReview,
  type ConvexAssignmentWager,
  type ConvexAssignmentWagerStatus,
  type ConvexAssignmentWorkbench,
  removeConvexAssignmentGuess,
  removeConvexAssignmentWager,
} from "@/convex/assignmentDetails";
import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAssignmentLinkedPoint,
  deleteConvexPoint,
  loadConvexPointWorkbench,
} from "@/convex/pointDetails";
import {
  type ConvexAdminQuoteSubmission,
  deleteConvexAdminQuote,
} from "@/convex/quotabunga";
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
 * Loads the episode's season and game results once the episode has loaded.
 * `revision` forces a reload behind a spinner; `resultsRevision` refreshes
 * the results in place so removing an entry keeps the admin's scroll position.
 */
export function useEpisodeResults(
  episode: ConvexAdminEpisodeDetail | null,
  revision: number,
  resultsRevision = 0
): EpisodeResultsState {
  const convex = useConvex();
  const [state, setState] = useState<EpisodeResultsState>({
    status: "loading",
  });
  const shownKey = useRef<string | null>(null);
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
    const loadKey = [id, number, date, assignmentKey, revision].join(":");
    if (shownKey.current !== loadKey) {
      setState({ status: "loading" });
    }
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
        if (active) {
          shownKey.current = loadKey;
          setState({ status: "ready", results });
        }
      })
      .catch((error: unknown) => {
        console.error("Episode results could not be loaded.", error);
        if (active) {
          shownKey.current = null;
          setState({ status: "failed" });
        }
      });
    return () => {
      active = false;
    };
  }, [assignmentKey, convex, date, id, number, resultsRevision, revision]);

  return state;
}

interface EntryRemoval {
  confirmation: string;
  commit: () => Promise<void>;
  success: string;
}

type RemoveEntry = (
  prepare: () => EntryRemoval | Promise<EntryRemoval>
) => void;

function removalErrorMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "This entry changed, or its point is shared with another record. Refresh and review it before retrying.";
    case "NOT_FOUND":
      return "This entry no longer exists. Refresh the results.";
    case "WRITE_DISABLED":
      return "Game changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The entry could not be removed.";
  }
}

/**
 * Confirms and runs one removal at a time. Controls stay disabled until the
 * refreshed results arrive, so a removed row cannot be acted on twice.
 */
function useEntryRemoval(
  state: EpisodeResultsState,
  onRemoved: () => void
): { busy: boolean; removeEntry: RemoveEntry } {
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [state]);

  const removeEntry: RemoveEntry = (prepare) => {
    setBusy(true);
    void (async () => {
      try {
        const removal = await prepare();
        if (!window.confirm(removal.confirmation)) {
          setBusy(false);
          return;
        }
        await removal.commit();
        toast.success(removal.success);
        onRemoved();
      } catch (error) {
        toast.error(removalErrorMessage(error));
        setBusy(false);
      }
    })();
  };
  return { busy, removeEntry };
}

function signedPoints(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function quoteRemovalMessage(quote: ConvexAdminQuoteSubmission): string {
  const award =
    quote.point === null
      ? ""
      : ` Its award of ${signedPoints(
          quote.point.adjustment ?? 0
        )} points is removed too.`;
  return `Delete the quote “${quote.quoteText}”?${award}`;
}

function guessRemovalMessage(
  review: ConvexAssignmentReview,
  guess: ConvexAssignmentGuess
): string {
  const listener = guess.user.name ?? "this listener";
  const host = review.reviewer?.name ?? "this host";
  return (
    `Delete ${listener}'s guess of ${guess.rating.name} for ${host}? ` +
    "If their guesses on this movie were settled, the settlement and all of its points are removed, and any remaining guesses must be settled again. " +
    "A point awarded by hand stays on their total."
  );
}

function wagerRemovalMessage(wager: ConvexAssignmentWager): string {
  const listener = wager.user.name ?? "this listener";
  const effect =
    wager.awardAdjustment !== null
      ? ` Its ${signedPoints(wager.awardAdjustment)} point award is removed from their total.`
      : wager.status === "pending" || wager.status === "locked"
      ? ` The ${wager.points} points it holds are released.`
      : "";
  return `Delete ${listener}'s ${wager.status} wager of ${wager.points} points?${effect}`;
}

function linkedPointRemovalMessage(
  point: ConvexAssignmentLinkedPoint,
  impact: {
    guessCount: number;
    gamblingEntryCount: number;
    tagVoteCount: number;
    quoteSubmissionCount: number;
  }
): string {
  const shared = [
    [impact.guessCount, "guess(es)"],
    [impact.gamblingEntryCount, "wager(s)"],
    [impact.quoteSubmissionCount, "quote(s)"],
    [impact.tagVoteCount, "tag vote(s)"],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`);
  const listener = point.user.name ?? "this listener";
  return (
    `Delete this ${signedPoints(point.value)} point entry for ${listener}?` +
    (shared.length === 0
      ? ""
      : ` It is also attached to ${shared.join(
          ", "
        )}, which stay but lose this point.`)
  );
}

function RemoveEntryButton({
  busy,
  label,
  onClick,
}: {
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="h-8 w-8 text-muted-foreground hover:text-destructive"
      disabled={busy}
      onClick={onClick}
      size="icon"
      title={label}
      variant="ghost"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
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
  busy,
  episodeId,
  quotes,
  removeEntry,
}: {
  busy: boolean;
  episodeId: string;
  quotes: ConvexAdminQuoteSubmission[];
  removeEntry: RemoveEntry;
}) {
  const convex = useConvex();
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
                <span className="ml-auto">
                  <RemoveEntryButton
                    busy={busy}
                    label="Remove quote"
                    onClick={() =>
                      removeEntry(() => ({
                        confirmation: quoteRemovalMessage(quote),
                        commit: () => deleteConvexAdminQuote(convex, quote),
                        success: "Quote removed.",
                      }))
                    }
                  />
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
  busy,
  removeEntry,
  workbenches,
}: {
  busy: boolean;
  removeEntry: RemoveEntry;
  workbenches: ConvexAssignmentWorkbench[];
}) {
  const convex = useConvex();
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
                                <RemoveEntryButton
                                  busy={busy}
                                  label={`Remove guess by ${
                                    guess.user.name ?? "unnamed listener"
                                  }`}
                                  onClick={() =>
                                    removeEntry(() => ({
                                      confirmation: guessRemovalMessage(
                                        review,
                                        guess
                                      ),
                                      commit: () =>
                                        removeConvexAssignmentGuess(
                                          convex,
                                          review.id,
                                          guess
                                        ),
                                      success: "Guess removed.",
                                    }))
                                  }
                                />
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
  busy,
  removeEntry,
  workbenches,
}: {
  busy: boolean;
  removeEntry: RemoveEntry;
  workbenches: ConvexAssignmentWorkbench[];
}) {
  const convex = useConvex();
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
                    <RemoveEntryButton
                      busy={busy}
                      label={`Remove wager by ${
                        wager.user.name ?? "unnamed listener"
                      }`}
                      onClick={() =>
                        removeEntry(() => ({
                          confirmation: wagerRemovalMessage(wager),
                          commit: () =>
                            removeConvexAssignmentWager(convex, wager),
                          success: "Wager removed.",
                        }))
                      }
                    />
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

function LinkedPointsCard({
  busy,
  linkedPoints,
  removeEntry,
  workbenches,
}: {
  busy: boolean;
  linkedPoints: ConvexAssignmentLinkedPoint[][] | null;
  removeEntry: RemoveEntry;
  workbenches: ConvexAssignmentWorkbench[];
}) {
  const convex = useConvex();
  const groups =
    linkedPoints === null
      ? []
      : workbenches
          .map(({ assignment }, index) => ({
            assignment,
            points: linkedPoints[index] ?? [],
          }))
          .filter(({ points }) => points.length > 0);
  const pointCount = groups.reduce(
    (sum, { points }) => sum + points.length,
    0
  );

  const removePoint = (point: ConvexAssignmentLinkedPoint) =>
    removeEntry(async () => {
      const workbench = await loadConvexPointWorkbench(convex, point.pointId);
      if (workbench === null) {
        throw new Error("The point no longer exists.");
      }
      return {
        confirmation: linkedPointRemovalMessage(point, workbench.impact),
        commit: () => deleteConvexPoint(convex, workbench),
        success: "Point removed.",
      };
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Assignment points
          {linkedPoints !== null && ` (${pointCount})`}
        </CardTitle>
        <CardDescription>
          Points linked directly to this episode&apos;s assignments, including
          settlement bonuses and manual adjustments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {linkedPoints === null ? (
          <p className="text-sm text-muted-foreground">
            Assignment points could not be loaded.
          </p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No points are linked to this episode&apos;s assignments.
          </p>
        ) : (
          groups.map(({ assignment, points }) => (
            <section className="space-y-3" key={assignment.id}>
              <AssignmentHeading assignment={assignment} />
              {points.map((point) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  key={point.linkId}
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {point.user.name ?? "Unnamed listener"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {point.pointTypeTitle ?? point.reason ?? "Manual point"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {signedPoints(point.value)} pts
                    </Badge>
                    <RemoveEntryButton
                      busy={busy}
                      label={`Remove point for ${
                        point.user.name ?? "unnamed listener"
                      }`}
                      onClick={() => removePoint(point)}
                    />
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
  onEntryRemoved,
  onRetry,
  state,
}: {
  episode: ConvexAdminEpisodeDetail;
  onEntryRemoved: () => void;
  onRetry: () => void;
  state: EpisodeResultsState;
}) {
  const { busy, removeEntry } = useEntryRemoval(state, onEntryRemoved);
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
      <QuotabungaCard
        busy={busy}
        episodeId={episode.id}
        quotes={results.quotes}
        removeEntry={removeEntry}
      />
      <GuessResultsCard
        busy={busy}
        removeEntry={removeEntry}
        workbenches={results.workbenches}
      />
      <WagerResultsCard
        busy={busy}
        removeEntry={removeEntry}
        workbenches={results.workbenches}
      />
      <LinkedPointsCard
        busy={busy}
        linkedPoints={results.linkedPoints}
        removeEntry={removeEntry}
        workbenches={results.workbenches}
      />
    </div>
  );
}
