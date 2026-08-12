import type { ConvexReactClient } from "convex/react";
import { useConvex } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  ArrowUpRight,
  Coins,
  ExternalLink,
  Gamepad2,
  Loader2,
  Mic2,
  Quote,
  RefreshCw,
  Sigma,
  Star,
  Target,
  Trophy,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
  loadConvexAssignmentWorkbenchById,
} from "../../convex/assignmentDetails";
import {
  type ConvexAdminEpisode,
} from "../../convex/episodes";
import { loadConvexAdminEpisodeByNumber } from "../../convex/episodeDetails";
import {
  BBPC_CLIENT_API_VERSION,
  getConvexDomainErrorCode,
} from "../../convex/identity";
import {
  type ConvexAdminQuoteSubmission,
  type ConvexQuotePlacement,
  awardConvexAdminQuotePlacements,
  loadConvexAdminQuoteEpisodes,
  loadConvexAdminQuoteSubmissions,
  snapshotConvexQuoteAwards,
} from "../../convex/quotabunga";
import {
  type ConvexAdminSeasonGamblingEntry,
  type ConvexAdminSeasonGuess,
  type ConvexAdminSeasonPerformance,
  adminGamblingEntrySchema,
  adminGuessSchema,
  loadConvexAdminSeasonPerformance,
} from "../../convex/seasonDetails";
import {
  type ConvexAdminSeason,
  loadConvexAdminSeasonsPage,
} from "../../convex/seasons";
import {
  type ConvexAdminUser,
  loadConvexAdminUsersPage,
} from "../../convex/users";
import {
  formatPlainDate,
  getPacificTodayPlainDate,
} from "../../lib/dates";
import {
  getAdminAssignmentPath,
  getAdminEpisodePath,
} from "../../lib/routes";
import { cn } from "../../lib/utils";

import RatingIcon from "../Review/RatingIcon";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  type AssignmentPointTotal,
  type AssignmentRecordingDisclosure,
  chunkRecordingValues,
  collectAllRecordingUsers,
  getAssignmentRecordingDisclosure,
  isRecordingGuessRevealed,
  selectRecordingManagementEpisode,
  summarizeEpisodePoints,
} from "./recordingManagementModel";

const listGuessesForAssignmentReference = makeFunctionReference<
  "query",
  { assignmentId: string },
  unknown
>("games/guesses:listForAssignment");

const listGamblingForAssignmentReference = makeFunctionReference<
  "query",
  { assignmentId: string },
  unknown
>("games/gambling:listForAssignment");

const assignmentPointTotalsReference = makeFunctionReference<
  "query",
  { userIds: string[]; assignmentIds: string[] },
  unknown
>("games/points:totalsForAssignments");

const awardGuessPointReference = makeFunctionReference<
  "mutation",
  { id: string; adjustment: number; reason: string },
  unknown
>("games/guesses:awardPoint");

const updateWagerStatusReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    status: "won" | "lost" | "rejected";
    expectedStatus: ConvexAdminSeasonGamblingEntry["status"];
  },
  unknown
>("games/gambling:updateStatus");

const assignmentPointTotalSchema = z.object({
  userId: z.string().min(1),
  assignmentId: z.string().min(1),
  total: z.number(),
});

type EpisodeAssignment = ConvexAdminEpisode["assignments"][number];

interface RecordingManagementData {
  episode: ConvexAdminEpisode | null;
  season: ConvexAdminSeason | null;
  performance: ConvexAdminSeasonPerformance | null;
  guesses: ConvexAdminSeasonGuess[];
  wagers: ConvexAdminSeasonGamblingEntry[];
  assignmentPoints: AssignmentPointTotal[];
  disclosures: Record<string, AssignmentRecordingDisclosure>;
  users: ConvexAdminUser[];
  submissions: ConvexAdminQuoteSubmission[];
}

async function loadAllSupportedUsers(
  client: ConvexReactClient
): Promise<ConvexAdminUser[]> {
  return collectAllRecordingUsers((cursor) =>
    loadConvexAdminUsersPage(client, cursor)
  );
}

async function loadAssignmentPointTotals(
  client: ConvexReactClient,
  users: ConvexAdminUser[],
  assignmentIds: string[]
): Promise<AssignmentPointTotal[]> {
  if (users.length === 0 || assignmentIds.length === 0) {
    return [];
  }
  const totals: AssignmentPointTotal[] = [];
  for (const userChunk of chunkRecordingValues(users, 100)) {
    const value = await client.query(assignmentPointTotalsReference, {
      userIds: userChunk.map(({ id }) => id),
      assignmentIds,
    });
    totals.push(...z.array(assignmentPointTotalSchema).parse(value));
  }
  return totals;
}

async function loadAssignmentGames(
  client: ConvexReactClient,
  assignmentIds: string[]
): Promise<{
  guesses: ConvexAdminSeasonGuess[];
  wagers: ConvexAdminSeasonGamblingEntry[];
}> {
  const rows = await Promise.all(
    assignmentIds.map(async (assignmentId) => {
      const [guesses, wagers] = await Promise.all([
        client.query(listGuessesForAssignmentReference, { assignmentId }),
        client.query(listGamblingForAssignmentReference, { assignmentId }),
      ]);
      return {
        guesses: z.array(adminGuessSchema).parse(guesses),
        wagers: z.array(adminGamblingEntrySchema).parse(wagers),
      };
    })
  );
  return {
    guesses: rows.flatMap((row) => row.guesses),
    wagers: rows.flatMap((row) => row.wagers),
  };
}

async function loadRecordingManagementData(
  client: ConvexReactClient
): Promise<RecordingManagementData> {
  const [quoteEpisodes, seasonPage, users] = await Promise.all([
    loadConvexAdminQuoteEpisodes(client),
    loadConvexAdminSeasonsPage(client, null),
    loadAllSupportedUsers(client),
  ]);
  const episodeCandidate = selectRecordingManagementEpisode(quoteEpisodes);
  const episode =
    episodeCandidate === null
      ? null
      : await loadConvexAdminEpisodeByNumber(client, episodeCandidate.number);
  const today = getPacificTodayPlainDate();
  const season =
    seasonPage.seasons.find(
      (candidate) =>
        (candidate.startedOn === null || candidate.startedOn <= today) &&
        (candidate.endedOn === null || candidate.endedOn >= today)
    ) ??
    seasonPage.seasons[0] ??
    null;

  const assignmentIds = episode?.assignments.map(({ id }) => id) ?? [];
  if (assignmentIds.length > 25) {
    throw new Error(
      "The episode exceeds the 25-assignment management safety bound."
    );
  }

  const [games, performance, submissions, assignmentPoints, workbenches] =
    await Promise.all([
      loadAssignmentGames(client, assignmentIds),
      season === null
        ? Promise.resolve(null)
        : loadConvexAdminSeasonPerformance(client, season.id),
      episode === null
        ? Promise.resolve([])
        : loadConvexAdminQuoteSubmissions(client, episode.id),
      loadAssignmentPointTotals(client, users, assignmentIds),
      Promise.all(
        assignmentIds.map((assignmentId) =>
          loadConvexAssignmentWorkbenchById(client, assignmentId)
        )
      ),
    ]);
  const disclosures = Object.fromEntries(
    workbenches.map((workbench, index) => {
      const assignmentId = assignmentIds[index];
      if (workbench === null || assignmentId === undefined) {
        throw new Error(
          "An episode assignment became unavailable while loading recording management."
        );
      }
      return [
        assignmentId,
        getAssignmentRecordingDisclosure(users, workbench.reviews),
      ];
    })
  );

  return {
    episode,
    season,
    performance,
    guesses: games.guesses,
    wagers: games.wagers,
    assignmentPoints,
    disclosures,
    users,
    submissions,
  };
}

function initials(name: string | null): string {
  if (name === null || name.trim().length === 0) {
    return "?";
  }
  return name
    .trim()
    .split(/\s+/u)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function writeFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The game changed after it loaded. Refresh before trying again.";
    case "VALIDATION_FAILED":
      return "That point or game result is not valid for this episode.";
    case "WRITE_DISABLED":
      return "Game changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The game result could not be saved.";
  }
}

export function SeasonLeaderboard({
  performance,
  season,
  onRefresh,
  refreshing,
}: {
  performance: ConvexAdminSeasonPerformance | null;
  season: ConvexAdminSeason | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <Card className="w-full overflow-hidden border-primary/20 bg-primary/5">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-3 text-2xl font-black">
              <Trophy className="h-6 w-6 text-primary" />
              Current Season Leaderboard
            </CardTitle>
            <CardDescription>
              {season === null
                ? "No season is configured."
                : `${season.title} · ${season.gameType.title}`}
            </CardDescription>
          </div>
          <Button
            aria-label="Refresh recording management"
            disabled={refreshing}
            onClick={onRefresh}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {performance === null || performance.userSummary.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            No season standings are available yet.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {performance.userSummary.map((summary, index) => (
              <Link
                className="group flex items-center gap-4 rounded-2xl border bg-card/70 p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                href={`/user/${encodeURIComponent(summary.user.id)}`}
                key={summary.user.id}
              >
                <span className="w-8 text-center font-black text-muted-foreground">
                  #{index + 1}
                </span>
                <Avatar className="h-11 w-11">
                  <AvatarImage src={summary.user.image ?? ""} />
                  <AvatarFallback>{initials(summary.user.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black">
                    {summary.user.name ?? "Unnamed user"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {summary.guessCount} guesses · {summary.gamblingCount} wagers
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-primary">{summary.total}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">points</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EpisodePointsSummary({
  assignmentPoints,
  guesses,
  users,
  wagers,
}: {
  assignmentPoints: AssignmentPointTotal[];
  guesses: ConvexAdminSeasonGuess[];
  users: ConvexAdminUser[];
  wagers: ConvexAdminSeasonGamblingEntry[];
}) {
  const rows = useMemo(
    () => summarizeEpisodePoints(guesses, wagers, assignmentPoints, users),
    [assignmentPoints, guesses, users, wagers]
  );
  return (
    <Card className="w-full border-amber-500/20 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-2xl font-black">
          <Sigma className="h-6 w-6 text-amber-500" />
          Episode Results Summary
        </CardTitle>
        <CardDescription>
          Exact awarded points for this episode, split by game source.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
            No points have been awarded for this episode yet.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row, index) => (
              <div className="rounded-2xl border bg-card/70 p-4" key={row.user.id}>
                <div className="mb-4 flex items-center gap-3">
                  <Avatar className="h-11 w-11 border border-amber-500/30">
                    <AvatarImage src={row.user.image ?? ""} />
                    <AvatarFallback>{initials(row.user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black">
                      {row.user.name ?? "Unnamed user"}
                    </p>
                    <Badge variant="outline">
                      {row.total > 0 ? "+" : ""}{row.total} points
                    </Badge>
                  </div>
                  {index === 0 && row.total > 0 && (
                    <Trophy className="h-5 w-5 text-yellow-500" />
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <PointBreakdown icon={Target} label="Guesses" value={row.guessPoints} />
                  <PointBreakdown icon={Coins} label="Gambling" value={row.gamblingPoints} />
                  <PointBreakdown icon={Star} label="Bonus / manual" value={row.bonusPoints} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PointBreakdown({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Target;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className="font-bold text-foreground">
        {value > 0 ? "+" : ""}{value}
      </span>
    </div>
  );
}

export function QuotabungaRecordingRound({
  episodeId,
  onRefresh,
  submissions,
}: {
  episodeId: string;
  onRefresh: () => void;
  submissions: ConvexAdminQuoteSubmission[];
}) {
  const client = useConvex();
  const included = useMemo(
    () =>
      submissions
        .filter((submission) => submission.status === "INCLUDED")
        .sort(
          (left, right) =>
            (left.bracketOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.bracketOrder ?? Number.MAX_SAFE_INTEGER)
        ),
    [submissions]
  );
  const [placements, setPlacements] = useState<
    Record<string, ConvexQuotePlacement | null>
  >({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPlacements(
      Object.fromEntries(
        included.map((submission) => [submission.id, submission.placement])
      )
    );
  }, [included]);

  const save = () => {
    setConfirming(false);
    setSaving(true);
    const includedIds = new Set(included.map(({ id }) => id));
    const nextPlacements = Object.entries(placements)
      .filter(
        (entry): entry is [string, ConvexQuotePlacement] =>
          entry[1] !== null && includedIds.has(entry[0])
      )
      .map(([submissionId, placement]) => ({ submissionId, placement }));
    void awardConvexAdminQuotePlacements(
      client,
      episodeId,
      nextPlacements,
      snapshotConvexQuoteAwards(submissions)
    )
      .then((result) => {
        toast.success(
          `Saved ${String(result.awarded)} Quotabunga result${
            result.awarded === 1 ? "" : "s"
          }.`
        );
        onRefresh();
      })
      .catch((error: unknown) => toast.error(writeFailureMessage(error)))
      .finally(() => setSaving(false));
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl font-black">
                <Quote className="h-6 w-6 text-primary" />
                Quotabunga Recording Round
              </CardTitle>
              <CardDescription>{included.length} included entries</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/quotabunga?episodeId=${encodeURIComponent(episodeId)}`}>
                  Manage round <ArrowUpRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button
                disabled={included.length === 0 || saving}
                onClick={() => setConfirming(true)}
                size="sm"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trophy className="mr-2 h-4 w-4" />}
                Award points
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {included.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              No entries have been included for this round yet.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {included.map((submission) => (
                <div className="space-y-3 rounded-xl border bg-muted/20 p-4" key={submission.id}>
                  <div className="flex justify-between gap-3 text-xs font-bold uppercase text-muted-foreground">
                    <span>Matchup #{submission.bracketOrder ?? "—"}</span>
                    <span>{submission.user.name ?? submission.user.email}</span>
                  </div>
                  <blockquote className="text-lg font-medium">
                    &ldquo;{submission.quoteText}&rdquo;
                  </blockquote>
                  <p className="text-sm text-muted-foreground">
                    {submission.sourceTitle} · {submission.sourceType}
                  </p>
                  {submission.clipUrl !== null && (
                    <a
                      className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline"
                      href={submission.clipUrl}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Open clip <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <select
                    aria-label={`Placement for ${submission.user.name ?? submission.sourceTitle}`}
                    className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                    onChange={(event) => {
                      const value = event.target.value;
                      setPlacements((current) => {
                        const next = { ...current };
                        const placement =
                          value === "" ? null : (Number(value) as ConvexQuotePlacement);
                        if (placement !== null) {
                          Object.entries(next).forEach(([id, currentPlacement]) => {
                            if (id !== submission.id && currentPlacement === placement) {
                              next[id] = null;
                            }
                          });
                        }
                        next[submission.id] = placement;
                        return next;
                      });
                    }}
                    value={placements[submission.id] ?? ""}
                  >
                    <option value="">No placement</option>
                    <option value="1">1st · 40 points</option>
                    <option value="2">2nd · 20 points</option>
                    <option value="3">3rd · 10 points</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <ConfirmModal
        description="This replaces the current Quotabunga placements and their owned point awards with the selections shown here."
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={save}
        title="Replace Quotabunga awards?"
      />
    </>
  );
}

function AssignmentGameCard({
  assignment,
  disclosure,
  guesses,
  onAwardGuess,
  onResolveWager,
  savingKey,
  wagers,
}: {
  assignment: EpisodeAssignment;
  disclosure: AssignmentRecordingDisclosure;
  guesses: ConvexAdminSeasonGuess[];
  onAwardGuess: (guess: ConvexAdminSeasonGuess) => void;
  onResolveWager: (
    wager: ConvexAdminSeasonGamblingEntry,
    status: "won" | "lost" | "rejected"
  ) => void;
  savingKey: string | null;
  wagers: ConvexAdminSeasonGamblingEntry[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>{assignment.movie.title}</CardTitle>
            <CardDescription>
              {assignment.type.replaceAll("_", " ")} · assigned by {assignment.user.name ?? "Unknown"}
            </CardDescription>
          </div>
          {assignment.slug === null ? (
            <Badge variant="outline">Missing assignment slug</Badge>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={getAdminAssignmentPath(assignment.slug)}>
                Manage ratings & guesses <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-black">
            <Target className="h-4 w-4" /> Guesses
          </h3>
          {guesses.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No guesses recorded.</p>
          ) : (
            guesses.map((guess) => {
              const actual = guess.assignmentReview.review.rating;
              const revealed = isRecordingGuessRevealed(guess);
              const correct = actual?.id === guess.rating.id;
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={guess.id}>
                  <div>
                    <p className="font-bold">{guess.user.name ?? "Unnamed listener"}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{guess.assignmentReview.review.user?.name ?? "Host"}</span>
                      {revealed ? (
                        <>
                          <span>· Guess</span><RatingIcon value={guess.rating.value} />
                          <span>· Actual</span><RatingIcon value={actual?.value ?? 0} />
                        </>
                      ) : (
                        <span>· Prediction hidden until this host rates</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!revealed ? (
                      <Badge variant="outline">Hidden</Badge>
                    ) : (
                      <>
                        <Badge variant={correct ? "default" : "outline"}>{correct ? "Correct" : "No award"}</Badge>
                        {guess.point !== null ? (
                          <Badge variant="secondary">{guess.point.total} pts awarded</Badge>
                        ) : correct ? (
                          <Button
                            disabled={savingKey !== null}
                            onClick={() => onAwardGuess(guess)}
                            size="sm"
                          >
                            Award point
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 font-black">
            <Coins className="h-4 w-4" /> Wagers
          </h3>
          {wagers.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No wagers recorded.</p>
          ) : !disclosure.allHostsRated ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="font-bold text-amber-700 dark:text-amber-300">
                {wagers.length} wager{wagers.length === 1 ? "" : "s"} · {wagers.reduce((sum, wager) => sum + wager.points, 0)} point pot
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {disclosure.activeHostCount === 0
                  ? "Wager details stay hidden until an active host is configured and rated."
                  : `${disclosure.ratedHostCount} of ${disclosure.activeHostCount} active hosts have rated. Details unlock after every host rates.`}
              </p>
            </div>
          ) : (
            wagers.map((wager) => {
              const active = wager.status === "pending" || wager.status === "locked";
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={wager.id}>
                  <div>
                    <p className="font-bold">{wager.user.name ?? "Unnamed listener"}</p>
                    <p className="text-xs text-muted-foreground">
                      {wager.points} points × {wager.gamblingType.multiplier} · {wager.gamblingType.title}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{wager.status}</Badge>
                    {wager.awardPoint !== null && <Badge variant="secondary">{wager.awardPoint.total} pts</Badge>}
                    {active && (
                      <>
                        <Button disabled={savingKey !== null} onClick={() => onResolveWager(wager, "won")} size="sm" variant="outline">Won</Button>
                        <Button disabled={savingKey !== null} onClick={() => onResolveWager(wager, "lost")} size="sm" variant="outline">Lost</Button>
                        <Button disabled={savingKey !== null} onClick={() => onResolveWager(wager, "rejected")} size="sm" variant="ghost">Reject</Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ConvexRecordingManagementPage() {
  const client = useConvex();
  const [data, setData] = useState<RecordingManagementData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const recordingAppUrl = process.env.NEXT_PUBLIC_BBPC_RECORDING_URL;

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setRefreshing(true);
    setLoadError(null);
    void loadRecordingManagementData(client)
      .then((loaded) => {
        if (active) {
          setData(loaded);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Recording management could not be loaded."
          );
        }
      })
      .finally(() => {
        if (active) {
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, revision]);

  const runWrite = (
    key: string,
    operation: () => Promise<unknown>,
    successMessage: string
  ) => {
    if (savingKey !== null) {
      return;
    }
    setSavingKey(key);
    void operation()
      .then(() => {
        toast.success(successMessage);
        refresh();
      })
      .catch((error: unknown) => toast.error(writeFailureMessage(error)))
      .finally(() => setSavingKey(null));
  };

  const awardGuess = (guess: ConvexAdminSeasonGuess) => {
    runWrite(
      `guess-${guess.id}`,
      async () =>
        adminGuessSchema.parse(
          await client.mutation(awardGuessPointReference, {
            id: guess.id,
            adjustment: 0,
            reason: "Correct prediction",
          })
        ),
      `Awarded a point to ${guess.user.name ?? "the listener"}.`
    );
  };

  const resolveWager = (
    wager: ConvexAdminSeasonGamblingEntry,
    status: "won" | "lost" | "rejected"
  ) => {
    runWrite(
      `wager-${wager.id}`,
      async () =>
        adminGamblingEntrySchema.parse(
          await client.mutation(updateWagerStatusReference, {
            clientApiVersion: BBPC_CLIENT_API_VERSION,
            id: wager.id,
            status,
            expectedStatus: wager.status,
          })
        ),
      `Marked the wager ${status}.`
    );
  };

  if (data === null && loadError === null) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (loadError !== null) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Recording management unavailable</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (data === null) {
    return null;
  }

  const { episode } = data;
  return (
    <>
      <Head><title>Recording Management - BBPC Admin</title></Head>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight">
              <Mic2 className="h-8 w-8 text-primary" /> Recording Management
            </h1>
            <p className="mt-1 text-muted-foreground">
              Run episode games, award points, and watch the season standings while recording.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={refreshing} onClick={refresh} variant="outline">
              <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />Refresh
            </Button>
            {recordingAppUrl !== undefined && (
              <Button asChild>
                <a href={recordingAppUrl} rel="noreferrer" target="_blank">
                  Open recording room <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </header>

        {episode === null ? (
          <Card>
            <CardHeader>
              <CardTitle>No episode is ready</CardTitle>
              <CardDescription>Create or mark an episode as next before opening its recording management tools.</CardDescription>
            </CardHeader>
            <CardContent><Button asChild variant="outline"><Link href="/episode">Manage episodes</Link></Button></CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-primary/20">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge>{episode.status ?? "unknown"}</Badge>
                      <span className="text-sm text-muted-foreground">Episode {episode.number}</span>
                    </div>
                    <CardTitle className="text-3xl">{episode.title}</CardTitle>
                    <CardDescription>{episode.description ?? "No episode description."}</CardDescription>
                  </div>
                  <Button asChild variant="outline">
                    <Link href={episode.slug === null ? "/episode" : getAdminEpisodePath(episode.slug)}>
                      Edit episode <ArrowUpRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              {data.season !== null && (
                <CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <Gamepad2 className="h-4 w-4" />
                  <span className="font-semibold text-foreground">{data.season.title}</span>
                  <span>{data.season.gameType.title}</span>
                  <span>
                    {data.season.startedOn === null ? "TBD" : formatPlainDate(data.season.startedOn)}
                    {" – "}
                    {data.season.endedOn === null ? "Present" : formatPlainDate(data.season.endedOn)}
                  </span>
                </CardContent>
              )}
            </Card>

            <QuotabungaRecordingRound episodeId={episode.id} onRefresh={refresh} submissions={data.submissions} />

            <section className="space-y-4">
              <div>
                <h2 className="text-2xl font-black">Episode games</h2>
                <p className="text-sm text-muted-foreground">Resolve wagers and award correct predictions. Open an assignment for rating and guess edits.</p>
              </div>
              {episode.assignments.length === 0 ? (
                <Card className="border-dashed"><CardContent className="p-6 text-sm text-muted-foreground">This episode has no assignments.</CardContent></Card>
              ) : (
                episode.assignments.map((assignment) => (
                  <AssignmentGameCard
                    assignment={assignment}
                    disclosure={data.disclosures[assignment.id] ?? {
                      activeHostCount: 0,
                      ratedHostCount: 0,
                      allHostsRated: false,
                    }}
                    guesses={data.guesses.filter((guess) => guess.assignmentReview.assignment.id === assignment.id)}
                    key={assignment.id}
                    onAwardGuess={awardGuess}
                    onResolveWager={resolveWager}
                    savingKey={savingKey}
                    wagers={data.wagers.filter((wager) => wager.assignment?.id === assignment.id)}
                  />
                ))
              )}
            </section>

            <EpisodePointsSummary assignmentPoints={data.assignmentPoints} guesses={data.guesses} users={data.users} wagers={data.wagers} />
          </>
        )}

        <SeasonLeaderboard performance={data.performance} season={data.season} onRefresh={refresh} refreshing={refreshing} />
      </main>
    </>
  );
}
