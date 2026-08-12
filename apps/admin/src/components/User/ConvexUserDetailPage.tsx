import { useConvex } from "convex/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  Coins,
  History,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Tag,
  Trash2,
  Trophy,
  UserRound,
  UserRoundCog,
  Vote,
  X,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  type ConvexAdminGameCatalog,
  loadConvexAdminGameCatalog,
} from "@/convex/gameConfig";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexImpersonationSession,
  loadCurrentConvexImpersonation,
  revokeConvexImpersonation,
  startConvexImpersonation,
} from "@/convex/impersonation";
import {
  type ConvexAdminRole,
  loadConvexAdminRoles,
} from "@/convex/roles";
import {
  type ConvexAdminSeason,
  loadConvexAdminSeasonsPage,
} from "@/convex/seasons";
import {
  type ConvexUserDetail,
  type ConvexUserGamblingEntry,
  type ConvexUserGuess,
  type ConvexUserPoint,
  type ConvexUserSeasonSelector,
  type ConvexUserSeasonTarget,
  type ConvexUserSyllabusEntry,
  type ConvexUserTagVote,
  applyConvexUserVotePoints,
  assignConvexUserRole,
  assignConvexUserSyllabusEpisode,
  createConvexUserPoint,
  createConvexUserWager,
  deleteConvexUserVote,
  loadConvexUserDetail,
  loadConvexUserGamblingPage,
  loadConvexUserGuessesPage,
  loadConvexUserPointTotal,
  loadConvexUserPointsPage,
  loadConvexUserSyllabus,
  loadConvexUserVotesPage,
  removeConvexUserRole,
  removeConvexUserSyllabusEntry,
  reorderConvexUserPendingSyllabus,
  setConvexUserStatus,
  unlinkConvexUserSyllabusEpisode,
  updateConvexUserProfile,
  updateConvexUserWagerPoints,
  updateConvexUserWagerStatus,
} from "@/convex/userDetails";
import {
  formatInstantLocal,
  getPacificTodayPlainDate,
} from "@/lib/dates";
import { getAdminAssignmentPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

function operationMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The user or a related record changed. Refresh before retrying.";
    case "VALIDATION_FAILED":
      return "Check the profile, point, wager, role, or syllabus values.";
    case "NOT_FOUND":
      return "The user or related record is no longer available.";
    case "WRITE_DISABLED":
      return "User changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The user operation could not be completed.";
  }
}

function LoadMore({
  disabled,
  done,
  onClick,
}: {
  disabled: boolean;
  done: boolean;
  onClick: () => void;
}) {
  if (done) {
    return null;
  }
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      size="sm"
      variant="outline"
    >
      Load more
    </Button>
  );
}

function SyllabusAssignControls({
  busy,
  entry,
  onAssign,
}: {
  busy: boolean;
  entry: ConvexUserSyllabusEntry;
  onAssign: (
    entry: ConvexUserSyllabusEntry,
    episodeNumber: number,
    type: string
  ) => void;
}) {
  const [episodeNumber, setEpisodeNumber] = useState("");
  const [type, setType] = useState("HOMEWORK");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Episode number for ${entry.movie.title}`}
        className="h-8 w-24"
        inputMode="numeric"
        onChange={(event) => setEpisodeNumber(event.target.value)}
        placeholder="Episode"
        type="number"
        value={episodeNumber}
      />
      <select
        aria-label={`Assignment type for ${entry.movie.title}`}
        className="h-8 rounded-md border bg-background px-2 text-xs"
        onChange={(event) => setType(event.target.value)}
        value={type}
      >
        <option value="HOMEWORK">Homework</option>
        <option value="EXTRA_CREDIT">Extra credit</option>
        <option value="BONUS">Bonus</option>
      </select>
      <Button
        disabled={
          busy ||
          !Number.isSafeInteger(Number(episodeNumber)) ||
          episodeNumber.trim().length === 0
        }
        onClick={() =>
          onAssign(entry, Number(episodeNumber), type)
        }
        size="sm"
      >
        Assign
      </Button>
    </div>
  );
}

export function ConvexUserDetailPage() {
  const client = useConvex();
  const router = useRouter();
  const idParam = router.query.id;
  const userId = Array.isArray(idParam) ? idParam[0] : idParam;
  const today = getPacificTodayPlainDate();
  const [user, setUser] = useState<ConvexUserDetail | null>(null);
  const [syllabus, setSyllabus] = useState<ConvexUserSyllabusEntry[]>([]);
  const [seasons, setSeasons] = useState<ConvexAdminSeason[]>([]);
  const [roles, setRoles] = useState<ConvexAdminRole[]>([]);
  const [catalog, setCatalog] = useState<ConvexAdminGameCatalog | null>(
    null
  );
  const [seasonSelection, setSeasonSelection] = useState("current");
  const [selectorsIncomplete, setSelectorsIncomplete] = useState(false);
  const [points, setPoints] = useState<ConvexUserPoint[]>([]);
  const [guesses, setGuesses] = useState<ConvexUserGuess[]>([]);
  const [wagers, setWagers] = useState<ConvexUserGamblingEntry[]>([]);
  const [votes, setVotes] = useState<ConvexUserTagVote[]>([]);
  const [pointTotal, setPointTotal] = useState(0);
  const [pointCursor, setPointCursor] = useState("");
  const [guessCursor, setGuessCursor] = useState("");
  const [wagerCursor, setWagerCursor] = useState("");
  const [voteCursor, setVoteCursor] = useState("");
  const [pointsDone, setPointsDone] = useState(true);
  const [guessesDone, setGuessesDone] = useState(true);
  const [wagersDone, setWagersDone] = useState(true);
  const [votesDone, setVotesDone] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [pointReason, setPointReason] = useState("");
  const [pointAdjustment, setPointAdjustment] = useState("0");
  const [pointTypeId, setPointTypeId] = useState("none");
  const [wagerPoints, setWagerPoints] = useState("0");
  const [wagerTypeId, setWagerTypeId] = useState("");
  const [impersonation, setImpersonation] =
    useState<ConvexImpersonationSession | null>(null);
  const [impersonationReason, setImpersonationReason] = useState("");
  const [impersonationDuration, setImpersonationDuration] =
    useState("15");

  const seasonSelector = useMemo<ConvexUserSeasonSelector>(
    () =>
      seasonSelection === "all"
        ? { kind: "all" }
        : seasonSelection === "current"
          ? { kind: "current", today }
          : { kind: "season", seasonId: seasonSelection },
    [seasonSelection, today]
  );
  const seasonTarget = useMemo<ConvexUserSeasonTarget | null>(
    () =>
      seasonSelector.kind === "all" ? null : seasonSelector,
    [seasonSelector]
  );

  const loadBase = useCallback(async () => {
    if (userId === undefined || userId.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextUser = await loadConvexUserDetail(client, userId);
      setUser(nextUser);
      if (nextUser === null) {
        setSyllabus([]);
        return;
      }
      const [
        nextSyllabus,
        seasonPage,
        nextRoles,
        nextCatalog,
        nextImpersonation,
      ] = await Promise.all([
        loadConvexUserSyllabus(client, userId),
        loadConvexAdminSeasonsPage(client, null),
        loadConvexAdminRoles(client),
        loadConvexAdminGameCatalog(client),
        loadCurrentConvexImpersonation(client),
      ]);
      setSyllabus(nextSyllabus);
      setSeasons(seasonPage.seasons);
      setSelectorsIncomplete(!seasonPage.isDone);
      setRoles(nextRoles);
      setCatalog(nextCatalog);
      setImpersonation(nextImpersonation);
    } catch (loadError) {
      setError(operationMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, userId]);

  const loadActivity = useCallback(async () => {
    if (
      userId === undefined ||
      userId.length === 0 ||
      user?.id !== userId
    ) {
      return;
    }
    setLoadingActivity(true);
    try {
      const [pointPage, total, guessPage, wagerPage, votePage] =
        await Promise.all([
          loadConvexUserPointsPage(
            client,
            userId,
            seasonSelector,
            null
          ),
          loadConvexUserPointTotal(client, userId, seasonSelector),
          loadConvexUserGuessesPage(
            client,
            userId,
            seasonSelector,
            null
          ),
          loadConvexUserGamblingPage(
            client,
            userId,
            seasonSelector,
            null
          ),
          loadConvexUserVotesPage(client, userId, null),
        ]);
      setPoints(pointPage.items);
      setPointCursor(pointPage.continueCursor);
      setPointsDone(pointPage.isDone);
      setPointTotal(total);
      setGuesses(guessPage.items);
      setGuessCursor(guessPage.continueCursor);
      setGuessesDone(guessPage.isDone);
      setWagers(wagerPage.items);
      setWagerCursor(wagerPage.continueCursor);
      setWagersDone(wagerPage.isDone);
      setVotes(votePage.items);
      setVoteCursor(votePage.continueCursor);
      setVotesDone(votePage.isDone);
    } catch (activityError) {
      toast.error(operationMessage(activityError));
    } finally {
      setLoadingActivity(false);
    }
  }, [client, seasonSelector, user?.id, userId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    if (user === null) {
      return;
    }
    setNameDraft(user.name ?? "");
    setEmailDraft(user.email ?? "");
  }, [user]);

  async function runMutation(
    key: string,
    operation: () => Promise<void>,
    success: string,
    refresh: "base" | "activity" | "all" = "all"
  ) {
    setBusy(key);
    try {
      await operation();
      toast.success(success);
      if (refresh === "base" || refresh === "all") {
        await loadBase();
      }
      if (refresh === "activity" || refresh === "all") {
        await loadActivity();
      }
    } catch (mutationError) {
      toast.error(operationMessage(mutationError));
    } finally {
      setBusy(null);
    }
  }

  async function loadMorePoints() {
    if (userId === undefined || pointsDone) return;
    const page = await loadConvexUserPointsPage(
      client,
      userId,
      seasonSelector,
      pointCursor
    );
    setPoints((current) => [...current, ...page.items]);
    setPointCursor(page.continueCursor);
    setPointsDone(page.isDone);
  }

  async function loadMoreGuesses() {
    if (userId === undefined || guessesDone) return;
    const page = await loadConvexUserGuessesPage(
      client,
      userId,
      seasonSelector,
      guessCursor
    );
    setGuesses((current) => [...current, ...page.items]);
    setGuessCursor(page.continueCursor);
    setGuessesDone(page.isDone);
  }

  async function loadMoreWagers() {
    if (userId === undefined || wagersDone) return;
    const page = await loadConvexUserGamblingPage(
      client,
      userId,
      seasonSelector,
      wagerCursor
    );
    setWagers((current) => [...current, ...page.items]);
    setWagerCursor(page.continueCursor);
    setWagersDone(page.isDone);
  }

  async function loadMoreVotes() {
    if (userId === undefined || votesDone) return;
    const page = await loadConvexUserVotesPage(
      client,
      userId,
      voteCursor
    );
    setVotes((current) => [...current, ...page.items]);
    setVoteCursor(page.continueCursor);
    setVotesDone(page.isDone);
  }

  function movePending(entryId: string, direction: -1 | 1) {
    if (user === null) return;
    const pending = syllabus.filter((entry) => entry.assignment === null);
    const index = pending.findIndex((entry) => entry.id === entryId);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= pending.length) return;
    const reordered = [...pending];
    const current = reordered[index];
    const swap = reordered[swapIndex];
    if (current === undefined || swap === undefined) return;
    reordered[index] = swap;
    reordered[swapIndex] = current;
    void runMutation(
      `reorder:${entryId}`,
      () =>
        reorderConvexUserPendingSyllabus(client, user.id, reordered),
      "Syllabus reordered",
      "base"
    );
  }

  function createPoint(event: FormEvent) {
    event.preventDefault();
    if (user === null || seasonTarget === null) return;
    const adjustment = Number(pointAdjustment);
    if (!Number.isSafeInteger(adjustment)) {
      toast.error("Point adjustment must be a whole number.");
      return;
    }
    void runMutation(
      "create-point",
      () =>
        createConvexUserPoint(client, {
          userId: user.id,
          season: seasonTarget,
          reason: pointReason.trim() || null,
          adjustment,
          gamePointTypeId: pointTypeId === "none" ? null : pointTypeId,
        }),
      "Point created",
      "activity"
    );
  }

  function createWager(event: FormEvent) {
    event.preventDefault();
    if (
      user === null ||
      seasonTarget === null ||
      wagerTypeId.length === 0
    ) {
      return;
    }
    const pointsValue = Number(wagerPoints);
    if (!Number.isSafeInteger(pointsValue) || pointsValue < 0) {
      toast.error("Wager points must be a non-negative whole number.");
      return;
    }
    void runMutation(
      "create-wager",
      () =>
        createConvexUserWager(client, {
          userId: user.id,
          season: seasonTarget,
          points: pointsValue,
          gamblingTypeId: wagerTypeId,
        }),
      "Wager created",
      "activity"
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <Card className="mx-auto mt-12 max-w-xl">
        <CardHeader>
          <CardTitle>User unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => void loadBase()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (user === null) {
    return (
      <Card className="mx-auto mt-12 max-w-xl">
        <CardHeader>
          <CardTitle>User not found</CardTitle>
          <CardDescription>
            No canonical user matches this identifier.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/user">Back to users</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const pendingSyllabus = syllabus.filter(
    (entry) => entry.assignment === null
  );
  const assignedSyllabus = syllabus.filter(
    (entry) => entry.assignment !== null
  );
  const availableRoles = roles.filter(
    (role) =>
      !user.roles.some((membership) => membership.role.id === role.id)
  );

  return (
    <>
      <Head>
        <title>{user.name ?? user.email ?? "User"} · BBPC Admin</title>
      </Head>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link href="/user">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Users
            </Link>
          </Button>
          <Button
            disabled={busy !== null}
            onClick={() => {
              void loadBase();
              void loadActivity();
            }}
            variant="outline"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user.image ?? ""} />
                <AvatarFallback>
                  <UserRound className="h-7 w-7" />
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">
                    {user.name ?? "Unnamed user"}
                  </h1>
                  <Badge
                    variant={
                      user.status === "active" ? "secondary" : "destructive"
                    }
                  >
                    {user.status}
                  </Badge>
                  {user.isAdmin && <Badge>Administrator</Badge>}
                </div>
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email ?? "No email"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid min-w-48 gap-1">
                <Label htmlFor="user-season">Season filter</Label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  id="user-season"
                  onChange={(event) =>
                    setSeasonSelection(event.target.value)
                  }
                  value={seasonSelection}
                >
                  <option value="current">Current season</option>
                  <option value="all">All time</option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.title}
                    </option>
                  ))}
                </select>
                {selectorsIncomplete && (
                  <p className="text-xs text-amber-700">
                    Showing the first 30 seasons.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 rounded-lg border bg-primary/5 px-4 py-2">
                <div className="text-right">
                  <p className="text-xs uppercase text-muted-foreground">
                    Total points
                  </p>
                  <p className="text-2xl font-bold">{pointTotal}</p>
                </div>
                <Trophy className="h-7 w-7 text-primary/50" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="activity">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="activity">
              <History className="mr-2 h-4 w-4" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="syllabus">
              <BookOpen className="mr-2 h-4 w-4" />
              Syllabus
            </TabsTrigger>
            <TabsTrigger value="votes">
              <Tag className="mr-2 h-4 w-4" />
              Votes
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-6 space-y-6" value="activity">
            {loadingActivity && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading activity…
              </p>
            )}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Point events</CardTitle>
                  <CardDescription>
                    Paginated canonical points. Destructive changes open the
                    exact point workbench.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {seasonTarget !== null && catalog !== null && (
                    <form
                      className="grid gap-3 rounded-lg border bg-muted/20 p-4"
                      onSubmit={createPoint}
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Input
                          onChange={(event) =>
                            setPointReason(event.target.value)
                          }
                          placeholder="Reason"
                          value={pointReason}
                        />
                        <Input
                          onChange={(event) =>
                            setPointAdjustment(event.target.value)
                          }
                          placeholder="Adjustment"
                          type="number"
                          value={pointAdjustment}
                        />
                        <select
                          className="h-10 rounded-md border bg-background px-3 text-sm"
                          onChange={(event) =>
                            setPointTypeId(event.target.value)
                          }
                          value={pointTypeId}
                        >
                          <option value="none">Manual</option>
                          {catalog.pointTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.title} ({type.points})
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        disabled={busy !== null}
                        size="sm"
                        type="submit"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add point
                      </Button>
                    </form>
                  )}
                  {points.map((point) => (
                    <Link
                      className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40"
                      href={`/point/${encodeURIComponent(point.id)}`}
                      key={point.id}
                    >
                      <div>
                        <p className="font-medium">
                          {point.reason ??
                            point.gamePointType?.title ??
                            "Manual point"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {point.season.title} ·{" "}
                          {formatInstantLocal(new Date(point.earnedAt))}
                        </p>
                      </div>
                      <Badge variant="outline">{point.total}</Badge>
                    </Link>
                  ))}
                  {points.length === 0 && !loadingActivity && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No point events.
                    </p>
                  )}
                  <LoadMore
                    disabled={busy !== null}
                    done={pointsDone}
                    onClick={() =>
                      void loadMorePoints().catch((pageError: unknown) =>
                        toast.error(operationMessage(pageError))
                      )
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Wagers</CardTitle>
                  <CardDescription>
                    Status and point edits carry the exact loaded state.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {seasonTarget !== null && catalog !== null && (
                    <form
                      className="grid gap-3 rounded-lg border bg-muted/20 p-4"
                      onSubmit={createWager}
                    >
                      <div className="grid gap-3 sm:grid-cols-2">
                        <select
                          className="h-10 rounded-md border bg-background px-3 text-sm"
                          onChange={(event) =>
                            setWagerTypeId(event.target.value)
                          }
                          value={wagerTypeId}
                        >
                          <option value="">Choose wager type</option>
                          {catalog.gamblingTypes.map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.title} × {type.multiplier}
                            </option>
                          ))}
                        </select>
                        <Input
                          min={0}
                          onChange={(event) =>
                            setWagerPoints(event.target.value)
                          }
                          type="number"
                          value={wagerPoints}
                        />
                      </div>
                      <Button
                        disabled={busy !== null || wagerTypeId.length === 0}
                        size="sm"
                        type="submit"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add wager
                      </Button>
                    </form>
                  )}
                  {wagers.map((entry) => (
                    <div className="rounded-lg border p-3" key={entry.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {entry.gamblingType.title} · {entry.points} points
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.season?.title ?? "Migrated seasonless"} ·{" "}
                            {formatInstantLocal(new Date(entry.createdAt))}
                          </p>
                        </div>
                        <Badge variant="outline">{entry.status}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(["won", "lost", "pending", "locked"] as const).map(
                          (status) => (
                            <Button
                              disabled={
                                busy !== null || entry.status === status
                              }
                              key={status}
                              onClick={() => {
                                const resolutionSeason =
                                  entry.season === null
                                    ? seasonTarget ?? undefined
                                    : undefined;
                                void runMutation(
                                  `wager-status:${entry.id}`,
                                  () =>
                                    updateConvexUserWagerStatus(
                                      client,
                                      entry,
                                      status,
                                      resolutionSeason
                                    ),
                                  `Wager set to ${status}`,
                                  "activity"
                                );
                              }}
                              size="sm"
                              variant="outline"
                            >
                              {status}
                            </Button>
                          )
                        )}
                        <Button
                          disabled={busy !== null}
                          onClick={() => {
                            const next = window.prompt(
                              "New whole-number wager amount",
                              String(entry.points)
                            );
                            if (next === null) return;
                            const value = Number(next);
                            if (
                              !Number.isSafeInteger(value) ||
                              value < 0
                            ) {
                              toast.error(
                                "Wager points must be a non-negative whole number."
                              );
                              return;
                            }
                            void runMutation(
                              `wager-points:${entry.id}`,
                              () =>
                                updateConvexUserWagerPoints(
                                  client,
                                  entry,
                                  value
                                ),
                              "Wager points updated",
                              "activity"
                            );
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          Edit points
                        </Button>
                      </div>
                    </div>
                  ))}
                  {wagers.length === 0 && !loadingActivity && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No wagers.
                    </p>
                  )}
                  <LoadMore
                    disabled={busy !== null}
                    done={wagersDone}
                    onClick={() =>
                      void loadMoreWagers().catch((pageError: unknown) =>
                        toast.error(operationMessage(pageError))
                      )
                    }
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Guess history</CardTitle>
                <CardDescription>
                  Native 30-row pages with hydrated review and award evidence.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {guesses.map((guess) => {
                  const review = guess.assignmentReview.review;
                  const title =
                    review.movie?.title ?? review.show?.title ?? "Unknown";
                  return (
                    <div className="rounded-lg border p-4" key={guess.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{title}</p>
                          <p className="text-xs text-muted-foreground">
                            Episode{" "}
                            {guess.assignmentReview.assignment.episode.number}{" "}
                            · {guess.rating.name}
                          </p>
                        </div>
                        <Badge variant={guess.point ? "secondary" : "outline"}>
                          {guess.point?.total ?? "Pending"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {guesses.length === 0 && !loadingActivity && (
                  <p className="md:col-span-2 py-6 text-center text-sm text-muted-foreground">
                    No guesses.
                  </p>
                )}
                <div className="md:col-span-2">
                  <LoadMore
                    disabled={busy !== null}
                    done={guessesDone}
                    onClick={() =>
                      void loadMoreGuesses().catch((pageError: unknown) =>
                        toast.error(operationMessage(pageError))
                      )
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-6" value="syllabus">
            <Card>
              <CardHeader>
                <CardTitle>User syllabus</CardTitle>
                <CardDescription>
                  Pending reorder, assignment, unlink, and deletion writes all
                  compare the exact loaded entry.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Pending queue
                  </h3>
                  {pendingSyllabus.map((entry, index) => (
                    <div
                      className={cn(
                        "flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center",
                        index === 0 && "border-primary/40 bg-primary/5"
                      )}
                      key={entry.id}
                    >
                      <div className="flex gap-1">
                        <Button
                          disabled={busy !== null || index === 0}
                          onClick={() => movePending(entry.id, -1)}
                          size="icon"
                          variant="ghost"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          disabled={
                            busy !== null ||
                            index === pendingSyllabus.length - 1
                          }
                          onClick={() => movePending(entry.id, 1)}
                          size="icon"
                          variant="ghost"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{entry.movie.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Queue {entry.order} · {entry.movie.year}
                        </p>
                      </div>
                      <SyllabusAssignControls
                        busy={busy !== null}
                        entry={entry}
                        onAssign={(target, episodeNumber, type) => {
                          void runMutation(
                            `assign:${target.id}`,
                            () =>
                              assignConvexUserSyllabusEpisode(
                                client,
                                target,
                                episodeNumber,
                                type
                              ),
                            "Episode assigned",
                            "base"
                          );
                        }}
                      />
                      <Button
                        disabled={busy !== null}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${entry.movie.title} from this syllabus?`
                            )
                          ) {
                            void runMutation(
                              `remove-syllabus:${entry.id}`,
                              () =>
                                removeConvexUserSyllabusEntry(client, entry),
                              "Syllabus entry removed",
                              "base"
                            );
                          }
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  {pendingSyllabus.length === 0 && (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No pending syllabus entries.
                    </p>
                  )}
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Assigned
                  </h3>
                  {assignedSyllabus.map((entry) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                      key={entry.id}
                    >
                      <div>
                        <p className="font-medium">{entry.movie.title}</p>
                        <p className="text-xs text-muted-foreground">
                          Episode {entry.assignment?.episode.number}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {entry.assignment !== null && (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={getAdminAssignmentPath(
                                entry.assignment.slug ?? entry.assignment.id
                              )}
                            >
                              View assignment
                            </Link>
                          </Button>
                        )}
                        <Button
                          disabled={busy !== null}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Unlink this assignment from the syllabus entry?"
                              )
                            ) {
                              void runMutation(
                                `unlink:${entry.id}`,
                                () =>
                                  unlinkConvexUserSyllabusEpisode(
                                    client,
                                    entry
                                  ),
                                "Assignment unlinked",
                                "base"
                              );
                            }
                          }}
                          size="icon"
                          variant="ghost"
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {assignedSyllabus.length === 0 && (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No assigned syllabus entries.
                    </p>
                  )}
                </section>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-6" value="votes">
            <Card>
              <CardHeader>
                <CardTitle>Tag votes</CardTitle>
                <CardDescription>
                  Paginated vote history with explicit live and historical
                  award evidence.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {votes.map((vote) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                    key={vote.id}
                  >
                    <div className="flex items-center gap-3">
                      <Vote className="h-4 w-4 text-purple-500" />
                      <div>
                        <p className="font-medium">{vote.tag}</p>
                        <p className="text-xs text-muted-foreground">
                          TMDB {vote.tmdbId} ·{" "}
                          {formatInstantLocal(new Date(vote.createdAt))}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {vote.award.kind === "point" ? (
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/point/${encodeURIComponent(
                              vote.award.point.id
                            )}`}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Awarded
                          </Link>
                        </Button>
                      ) : vote.award.kind === "legacyAwardTombstone" ? (
                        <Badge variant="outline">Historical award</Badge>
                      ) : (
                        <Button
                          disabled={busy !== null}
                          onClick={() => {
                            void runMutation(
                              `award-vote:${vote.id}`,
                              () =>
                                applyConvexUserVotePoints(
                                  client,
                                  vote.id,
                                  today
                                ),
                              "Vote points applied",
                              "activity"
                            );
                          }}
                          size="sm"
                          variant="outline"
                        >
                          <Coins className="mr-2 h-4 w-4" />
                          Apply points
                        </Button>
                      )}
                      <Button
                        disabled={busy !== null}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Delete this vote while preserving any separate point award?"
                            )
                          ) {
                            void runMutation(
                              `delete-vote:${vote.id}`,
                              () => deleteConvexUserVote(client, vote.id),
                              "Vote deleted",
                              "activity"
                            );
                          }
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                {votes.length === 0 && !loadingActivity && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No tag votes.
                  </p>
                )}
                <LoadMore
                  disabled={busy !== null}
                  done={votesDone}
                  onClick={() =>
                    void loadMoreVotes().catch((pageError: unknown) =>
                      toast.error(operationMessage(pageError))
                    )
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="mt-6" value="settings">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Account details</CardTitle>
                  <CardDescription>
                    Profile and status writes compare the exact loaded user.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="user-name">Name</Label>
                    <Input
                      id="user-name"
                      onChange={(event) => setNameDraft(event.target.value)}
                      value={nameDraft}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="user-email">Email</Label>
                    <Input
                      id="user-email"
                      onChange={(event) => setEmailDraft(event.target.value)}
                      type="email"
                      value={emailDraft}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
                    <Button
                      disabled={busy !== null}
                      onClick={() => {
                        const next =
                          user.status === "active" ? "disabled" : "active";
                        if (
                          window.confirm(
                            `${next === "disabled" ? "Disable" : "Activate"} this user?`
                          )
                        ) {
                          void runMutation(
                            "status",
                            () =>
                              setConvexUserStatus(client, user, next),
                            `User ${next}`,
                            "base"
                          );
                        }
                      }}
                      variant={
                        user.status === "active" ? "destructive" : "outline"
                      }
                    >
                      {user.status === "active"
                        ? "Disable user"
                        : "Activate user"}
                    </Button>
                    <Button
                      disabled={
                        busy !== null ||
                        nameDraft.trim().length === 0 ||
                        emailDraft.trim().length === 0
                      }
                      onClick={() => {
                        void runMutation(
                          "profile",
                          () =>
                            updateConvexUserProfile(client, user, {
                              name: nameDraft,
                              email: emailDraft,
                            }),
                          "Profile updated",
                          "base"
                        );
                      }}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Save profile
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Permissions and roles</CardTitle>
                  <CardDescription>
                    Final active administrator protection remains
                    authoritative in Convex.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <select
                      className="h-10 flex-1 rounded-md border bg-background px-3 text-sm"
                      onChange={(event) => setRoleDraft(event.target.value)}
                      value={roleDraft}
                    >
                      <option value="">Choose role</option>
                      {availableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={busy !== null || roleDraft.length === 0}
                      onClick={() => {
                        void runMutation(
                          `role:${roleDraft}`,
                          () =>
                            assignConvexUserRole(
                              client,
                              user.id,
                              roleDraft
                            ),
                          "Role assigned",
                          "base"
                        );
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {user.roles.map((membership) => (
                      <div
                        className="flex items-center gap-2 rounded-full border bg-primary/5 px-3 py-2"
                        key={membership.id}
                      >
                        <Shield className="h-3.5 w-3.5" />
                        <span className="text-sm font-medium">
                          {membership.role.name}
                        </span>
                        <button
                          aria-label={`Remove ${membership.role.name}`}
                          className="text-muted-foreground hover:text-destructive"
                          disabled={busy !== null}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove the ${membership.role.name} role?`
                              )
                            ) {
                              void runMutation(
                                `remove-role:${membership.id}`,
                                () =>
                                  removeConvexUserRole(
                                    client,
                                    user.id,
                                    membership
                                  ),
                                "Role removed",
                                "base"
                              );
                            }
                          }}
                          type="button"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    {user.roles.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No roles assigned.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Audited impersonation</CardTitle>
                  <CardDescription>
                    Temporarily use member-scoped public features as this
                    account. Administrator permissions stay attached to your
                    real account and never transfer to the target.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {impersonation === null ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-[1fr_10rem]">
                        <div className="grid gap-2">
                          <Label htmlFor="impersonation-reason">
                            Support reason
                          </Label>
                          <Input
                            id="impersonation-reason"
                            maxLength={500}
                            onChange={(event) =>
                              setImpersonationReason(event.target.value)
                            }
                            placeholder="Describe the support task"
                            value={impersonationReason}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="impersonation-duration">
                            Duration
                          </Label>
                          <select
                            className="h-10 rounded-md border bg-background px-3 text-sm"
                            id="impersonation-duration"
                            onChange={(event) =>
                              setImpersonationDuration(event.target.value)
                            }
                            value={impersonationDuration}
                          >
                            <option value="5">5 minutes</option>
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="60">60 minutes</option>
                          </select>
                        </div>
                      </div>
                      <Button
                        disabled={
                          busy !== null ||
                          user.status !== "active" ||
                          impersonationReason.trim().length < 10
                        }
                        onClick={() => {
                          const durationMinutes = Number(
                            impersonationDuration
                          );
                          void runMutation(
                            "impersonation:start",
                            async () => {
                              const session =
                                await startConvexImpersonation(client, {
                                  targetUserId: user.id,
                                  reason: impersonationReason,
                                  durationMinutes,
                                });
                              setImpersonation(session);
                              setImpersonationReason("");
                            },
                            "Impersonation started. Open the public app to use member features.",
                            "base"
                          );
                        }}
                      >
                        <UserRoundCog className="mr-2 h-4 w-4" />
                        Impersonate this user
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
                      <div>
                        <p className="font-medium">
                          Impersonating{" "}
                          {impersonation.targetName ?? "unnamed user"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Ends{" "}
                          {formatInstantLocal(
                            new Date(impersonation.endsAt)
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {impersonation.reason}
                        </p>
                      </div>
                      <Button
                        disabled={busy !== null}
                        onClick={() => {
                          void runMutation(
                            "impersonation:revoke",
                            () =>
                              revokeConvexImpersonation(
                                client,
                                impersonation.id
                              ),
                            "Impersonation ended",
                            "base"
                          );
                        }}
                        variant="outline"
                      >
                        End impersonation
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
