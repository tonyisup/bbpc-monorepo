import { useConvex } from "convex/react";
import { format } from "date-fns";
import {
  Calendar,
  ChevronLeft,
  Coins,
  Edit,
  History,
  Loader2,
  RefreshCw,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  type ConvexAdminSeasonGamblingEntry,
  type ConvexAdminSeasonGuess,
  type ConvexAdminSeasonPerformance,
  type ConvexAdminSeasonPoint,
  loadConvexAdminSeasonDetail,
  loadConvexAdminSeasonGamblingPage,
  loadConvexAdminSeasonGuessesPage,
  loadConvexAdminSeasonPerformance,
  loadConvexAdminSeasonPointsPage,
} from "@/convex/seasonDetails";
import {
  type ConvexAdminGameType,
  type ConvexAdminSeason,
  loadConvexAdminGameTypes,
  updateConvexAdminSeason,
} from "@/convex/seasons";
import { formatInstantLocal, formatPlainDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import {
  ConvexSeasonEditor,
  seasonMutationFailureMessage,
} from "./ConvexSeasonsPage";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f43f5e",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

interface PageState<T> {
  items: T[];
  continueCursor: string | null;
  isDone: boolean;
  failed: boolean;
}

function initials(name: string | null): string {
  if (name === null) {
    return "U";
  }
  return (
    name
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

function countLabel(count: { count: number; isExact: boolean }): string {
  return `${count.isExact ? "" : "≥"}${count.count}`;
}

function activityPage<T>(
  result: {
    items: T[];
    continueCursor: string;
    isDone: boolean;
  },
  currentItems: T[] = []
): PageState<T> {
  return {
    items: [...currentItems, ...result.items],
    continueCursor: result.isDone ? null : result.continueCursor,
    isDone: result.isDone,
    failed: false,
  };
}

function ActivityFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        This activity feed could not be loaded. No SQL fallback was attempted.
      </p>
      <Button className="mt-4 gap-2" onClick={onRetry} variant="outline">
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  );
}

function LoadMoreButton({
  isLoading,
  onClick,
}: {
  isLoading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center pt-4">
      <Button
        className="gap-2"
        disabled={isLoading}
        onClick={onClick}
        variant="outline"
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        Load more
      </Button>
    </div>
  );
}

export function ConvexSeasonDetailPage() {
  const router = useRouter();
  const convex = useConvex();
  const seasonId =
    typeof router.query.id === "string" ? router.query.id : null;
  const [season, setSeason] = useState<
    ConvexAdminSeason | null | undefined
  >(undefined);
  const [gameTypes, setGameTypes] = useState<
    ConvexAdminGameType[] | null
  >(null);
  const [performance, setPerformance] = useState<
    ConvexAdminSeasonPerformance | null | undefined
  >(undefined);
  const [points, setPoints] =
    useState<PageState<ConvexAdminSeasonPoint> | null>(null);
  const [guesses, setGuesses] =
    useState<PageState<ConvexAdminSeasonGuess> | null>(null);
  const [gambling, setGambling] =
    useState<PageState<ConvexAdminSeasonGamblingEntry> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState<
    "points" | "guesses" | "gambling" | null
  >(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (seasonId === null) {
      return;
    }
    let active = true;
    setSeason(undefined);
    setGameTypes(null);
    setPerformance(undefined);
    setPoints(null);
    setGuesses(null);
    setGambling(null);
    setLoadFailed(false);

    void Promise.all([
      loadConvexAdminSeasonDetail(convex, seasonId),
      loadConvexAdminGameTypes(convex),
    ])
      .then(([loadedSeason, loadedGameTypes]) => {
        if (active) {
          setSeason(loadedSeason);
          setGameTypes(loadedGameTypes);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });

    void Promise.allSettled([
      loadConvexAdminSeasonPerformance(convex, seasonId),
      loadConvexAdminSeasonPointsPage(convex, seasonId, null),
      loadConvexAdminSeasonGuessesPage(convex, seasonId, null),
      loadConvexAdminSeasonGamblingPage(convex, seasonId, null),
    ]).then(([performanceResult, pointsResult, guessesResult, gamblingResult]) => {
      if (!active) {
        return;
      }
      setPerformance(
        performanceResult.status === "fulfilled"
          ? performanceResult.value
          : null
      );
      setPoints(
        pointsResult.status === "fulfilled"
          ? activityPage(pointsResult.value)
          : { items: [], continueCursor: null, isDone: true, failed: true }
      );
      setGuesses(
        guessesResult.status === "fulfilled"
          ? activityPage(guessesResult.value)
          : { items: [], continueCursor: null, isDone: true, failed: true }
      );
      setGambling(
        gamblingResult.status === "fulfilled"
          ? activityPage(gamblingResult.value)
          : { items: [], continueCursor: null, isDone: true, failed: true }
      );
    });

    return () => {
      active = false;
    };
  }, [convex, revision, seasonId]);

  const chartData = useMemo(() => {
    if (performance === null || performance === undefined) {
      return [];
    }
    const runningTotals: Record<string, number> = {};
    performance.userSummary.forEach(({ user }) => {
      runningTotals[user.id] = 0;
    });
    const rows = new Map<string, Record<string, number | string>>();
    performance.points.forEach((point) => {
      runningTotals[point.userId] =
        (runningTotals[point.userId] ?? 0) + point.pointValue;
      const date = format(new Date(point.earnedAt), "MMM dd");
      rows.set(date, { date, ...runningTotals });
    });
    return [...rows.values()];
  }, [performance]);

  const refresh = () => setRevision((value) => value + 1);

  const loadMorePoints = () => {
    if (
      seasonId === null ||
      points === null ||
      points.continueCursor === null
    ) {
      return;
    }
    setLoadingMore("points");
    void loadConvexAdminSeasonPointsPage(
      convex,
      seasonId,
      points.continueCursor
    )
      .then((result) =>
        setPoints((current) =>
          activityPage(result, current?.items ?? [])
        )
      )
      .catch(() => toast.error("The next point page could not be loaded."))
      .finally(() => setLoadingMore(null));
  };

  const loadMoreGuesses = () => {
    if (
      seasonId === null ||
      guesses === null ||
      guesses.continueCursor === null
    ) {
      return;
    }
    setLoadingMore("guesses");
    void loadConvexAdminSeasonGuessesPage(
      convex,
      seasonId,
      guesses.continueCursor
    )
      .then((result) =>
        setGuesses((current) =>
          activityPage(result, current?.items ?? [])
        )
      )
      .catch(() => toast.error("The next guess page could not be loaded."))
      .finally(() => setLoadingMore(null));
  };

  const loadMoreGambling = () => {
    if (
      seasonId === null ||
      gambling === null ||
      gambling.continueCursor === null
    ) {
      return;
    }
    setLoadingMore("gambling");
    void loadConvexAdminSeasonGamblingPage(
      convex,
      seasonId,
      gambling.continueCursor
    )
      .then((result) =>
        setGambling((current) =>
          activityPage(result, current?.items ?? [])
        )
      )
      .catch(() => toast.error("The next wager page could not be loaded."))
      .finally(() => setLoadingMore(null));
  };

  if (loadFailed) {
    return (
      <div className="mx-auto flex min-h-[420px] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">Season details unavailable</h1>
        <p className="text-sm text-muted-foreground">
          Convex could not load the requested season. No SQL fallback was
          attempted.
        </p>
        <Button className="gap-2" onClick={refresh} variant="outline">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (season === undefined) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (season === null) {
    return (
      <div className="mx-auto flex min-h-[420px] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">Season not found</h1>
        <Button asChild variant="outline">
          <Link href="/season">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to seasons
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{season.title} - BBPC Admin</title>
      </Head>
      {isEditing && gameTypes !== null && (
        <ConvexSeasonEditor
          editingSeason={season}
          gameTypes={gameTypes}
          isSaving={isSaving}
          onClose={() => setIsEditing(false)}
          onSave={(input) => {
            setIsSaving(true);
            void updateConvexAdminSeason(convex, season.id, input)
              .then(() => {
                toast.success("Season updated.");
                setIsEditing(false);
                refresh();
              })
              .catch((error: unknown) =>
                toast.error(seasonMutationFailureMessage(error))
              )
              .finally(() => setIsSaving(false));
          }}
        />
      )}
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8">
        <nav className="flex items-center gap-2 border-b border-dashed pb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <Link className="hover:text-primary" href="/season">
            Seasons
          </Link>
          <ChevronLeft className="h-3 w-3 rotate-180 opacity-30" />
          <span className="truncate text-foreground">{season.title}</span>
        </nav>

        <section className="flex flex-col justify-between gap-6 border-b pb-6 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">Season details</Badge>
              <Badge variant="secondary">{season.gameType.title}</Badge>
            </div>
            <h1 className="text-4xl font-black tracking-tight">
              {season.title}
            </h1>
            {season.description !== null && (
              <p className="mt-2 max-w-2xl text-muted-foreground">
                {season.description}
              </p>
            )}
            <Button
              className="mt-4 gap-2"
              disabled={gameTypes === null}
              onClick={() => setIsEditing(true)}
              size="sm"
              variant="outline"
            >
              <Edit className="h-4 w-4" />
              Edit season
            </Button>
          </div>
          <div className="flex items-center gap-4 rounded-2xl border border-dashed bg-muted/30 p-4">
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Start date
              </span>
              <span className="flex items-center gap-1.5 text-sm font-bold">
                <Calendar className="h-4 w-4 text-primary" />
                {season.startedOn === null
                  ? "TBD"
                  : formatPlainDate(season.startedOn)}
              </span>
            </div>
            {season.endedOn !== null && (
              <div className="border-l pl-4">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  End date
                </span>
                <span className="text-sm font-bold">
                  {formatPlainDate(season.endedOn)}
                </span>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              label: "Point activity",
              count: season.counts.points,
              icon: TrendingUp,
            },
            {
              label: "Guesses",
              count: season.counts.guesses,
              icon: Target,
            },
            {
              label: "Wagers",
              count: season.counts.gamblingEntries,
              icon: Coins,
            },
          ].map(({ label, count, icon: Icon }) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black">
                  {countLabel(count)}
                </div>
                {!count.isExact && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bounded count; at least this many records exist.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-2">
            {performance === undefined ? (
              <Card>
                <CardContent className="flex h-[360px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : performance === null ? (
              <Card>
                <CardHeader>
                  <CardTitle>Performance summary unavailable</CardTitle>
                  <CardDescription>
                    The exact aggregate exceeded its safety bound or contained
                    an invalid relationship. Activity pages remain available.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button className="gap-2" onClick={refresh} variant="outline">
                    <RefreshCw className="h-4 w-4" />
                    Retry summary
                  </Button>
                </CardContent>
              </Card>
            ) : chartData.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Performance tracking
                  </CardTitle>
                  <CardDescription>
                    Exact cumulative point progression for this season.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[320px]">
                    <ResponsiveContainer height="100%" width="100%">
                      <AreaChart data={chartData}>
                        <CartesianGrid
                          stroke="hsl(var(--muted-foreground) / 0.1)"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis dataKey="date" fontSize={10} />
                        <YAxis fontSize={10} />
                        <Tooltip />
                        <Legend />
                        {performance.userSummary.map(({ user }, index) => (
                          <Area
                            dataKey={user.id}
                            fill={CHART_COLORS[index % CHART_COLORS.length]}
                            fillOpacity={0.08}
                            key={user.id}
                            name={user.name ?? "User"}
                            stroke={CHART_COLORS[index % CHART_COLORS.length]}
                            strokeWidth={2}
                            type="monotone"
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Tabs defaultValue="points">
              <TabsList className="grid w-full max-w-md grid-cols-3">
                <TabsTrigger value="points">Timeline</TabsTrigger>
                <TabsTrigger value="guesses">Guesses</TabsTrigger>
                <TabsTrigger value="gambling">Wagers</TabsTrigger>
              </TabsList>

              <TabsContent className="space-y-3 pt-4" value="points">
                {points === null ? (
                  <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin text-muted-foreground" />
                ) : points.failed ? (
                  <ActivityFailure onRetry={refresh} />
                ) : points.items.length === 0 ? (
                  <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No point activity has been recorded.
                  </p>
                ) : (
                  <>
                    {points.items.map((point) => (
                      <Card key={point.id}>
                        <CardContent className="flex items-center justify-between gap-4 p-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarImage src={point.user.image ?? ""} />
                              <AvatarFallback>
                                {initials(point.user.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold">
                                {point.user.name ?? "Unnamed user"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {point.gamePointType?.title ??
                                  point.reason ??
                                  "Manual adjustment"}{" "}
                                · {formatInstantLocal(new Date(point.earnedAt))}
                              </p>
                            </div>
                          </div>
                          <Badge
                            className={cn(
                              "font-mono",
                              point.total >= 0
                                ? "bg-emerald-500/10 text-emerald-700"
                                : "bg-rose-500/10 text-rose-700"
                            )}
                          >
                            {point.total > 0 ? "+" : ""}
                            {point.total}
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                    {!points.isDone && (
                      <LoadMoreButton
                        isLoading={loadingMore === "points"}
                        onClick={loadMorePoints}
                      />
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent className="space-y-3 pt-4" value="guesses">
                {guesses === null ? (
                  <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin text-muted-foreground" />
                ) : guesses.failed ? (
                  <ActivityFailure onRetry={refresh} />
                ) : guesses.items.length === 0 ? (
                  <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No guesses have been submitted.
                  </p>
                ) : (
                  <>
                    {guesses.items.map((guess) => {
                      const review = guess.assignmentReview.review;
                      return (
                        <Card key={guess.id}>
                          <CardContent className="flex items-center justify-between gap-4 p-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar className="h-9 w-9">
                                <AvatarImage src={guess.user.image ?? ""} />
                                <AvatarFallback>
                                  {initials(guess.user.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold">
                                  {guess.user.name ?? "Unnamed user"}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {review.movie?.title ??
                                    review.show?.title ??
                                    "Unknown target"}{" "}
                                  ·{" "}
                                  {formatInstantLocal(
                                    new Date(guess.createdAt)
                                  )}
                                </p>
                              </div>
                            </div>
                            <Badge variant="secondary">
                              {guess.rating.value} · {guess.rating.name}
                            </Badge>
                          </CardContent>
                        </Card>
                      );
                    })}
                    {!guesses.isDone && (
                      <LoadMoreButton
                        isLoading={loadingMore === "guesses"}
                        onClick={loadMoreGuesses}
                      />
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent className="space-y-3 pt-4" value="gambling">
                {gambling === null ? (
                  <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin text-muted-foreground" />
                ) : gambling.failed ? (
                  <ActivityFailure onRetry={refresh} />
                ) : gambling.items.length === 0 ? (
                  <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No wagers have been recorded.
                  </p>
                ) : (
                  <>
                    {gambling.items.map((entry) => (
                      <Card key={entry.id}>
                        <CardContent className="flex items-center justify-between gap-4 p-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarImage src={entry.user.image ?? ""} />
                              <AvatarFallback>
                                {initials(entry.user.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold">
                                {entry.user.name ?? "Unnamed user"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {entry.gamblingType.title}
                                {entry.assignment === null
                                  ? ""
                                  : ` · ${entry.assignment.movie.title}`}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-black">{entry.points} pts</p>
                            <Badge variant="outline">{entry.status}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {!gambling.isDone && (
                      <LoadMoreButton
                        isLoading={loadingMore === "gambling"}
                        onClick={loadMoreGambling}
                      />
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>

          <aside className="space-y-4">
            <h2 className="flex items-center gap-2 text-2xl font-black">
              <Trophy className="h-6 w-6 text-primary" />
              Leaderboard
            </h2>
            {performance === undefined ? (
              <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin text-muted-foreground" />
            ) : performance === null ? (
              <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                The exact leaderboard is unavailable because its bounded
                aggregate failed closed.
              </p>
            ) : performance.userSummary.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
                No participants yet.
              </p>
            ) : (
              performance.userSummary.map((summary, index) => (
                <Card key={summary.user.id}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <span className="w-8 text-center font-black text-muted-foreground">
                      #{index + 1}
                    </span>
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={summary.user.image ?? ""} />
                      <AvatarFallback>
                        {initials(summary.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {summary.user.name ?? "Unnamed user"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {summary.guessCount} guesses ·{" "}
                        {summary.gamblingCount} wagers
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-primary">
                        {summary.total}
                      </p>
                      <p className="text-[10px] uppercase text-muted-foreground">
                        points
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="h-4 w-4" />
                  Safety bounds
                </CardTitle>
                <CardDescription>
                  Activity is paginated in 30-row pages. The leaderboard and
                  chart require exact aggregates and fail closed above their
                  backend cap.
                </CardDescription>
              </CardHeader>
            </Card>
          </aside>
        </section>
      </main>
    </>
  );
}
