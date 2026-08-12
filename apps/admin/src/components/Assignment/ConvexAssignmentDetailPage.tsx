import { useConvex } from "convex/react";
import {
  ArrowLeft,
  Coins,
  ExternalLink,
  Film,
  Headphones,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserRound,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

import {
  type ConvexAssignmentAudioMessage,
  type ConvexAssignmentGuess,
  type ConvexAssignmentReview,
  type ConvexAssignmentType,
  type ConvexAssignmentWager,
  type ConvexAssignmentWagerStatus,
  type ConvexAssignmentWorkbench,
  createConvexAssignmentGuess,
  createConvexAssignmentReview,
  deleteConvexAssignment,
  loadConvexAssignmentAudioPage,
  loadConvexAssignmentWorkbench,
  removeConvexAssignmentAudio,
  removeConvexAssignmentGuess,
  removeConvexAssignmentReview,
  updateConvexAssignmentGuessRating,
  updateConvexAssignmentIdentity,
  updateConvexAssignmentReviewRating,
  updateConvexAssignmentWagerStatus,
} from "@/convex/assignmentDetails";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminRating,
  loadConvexAdminRatings,
} from "@/convex/ratings";
import {
  type ConvexAdminSeason,
  loadConvexAdminSeasonsPage,
} from "@/convex/seasons";
import {
  type ConvexAdminUser,
  loadConvexAdminUsersPage,
} from "@/convex/users";
import { formatInstantLocal } from "@/lib/dates";
import {
  getAdminAssignmentPath,
  getAdminEpisodePath,
} from "@/lib/routes";
import { cn } from "@/lib/utils";

import RatingIcon from "../Review/RatingIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { Separator } from "../ui/separator";

function operationMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The assignment changed, a relationship reached its safety limit, or protected history would be removed. Refresh before retrying.";
    case "VALIDATION_FAILED":
      return "Check the selected user, rating, season, status, and slug.";
    case "WRITE_DISABLED":
      return "Assignment changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The assignment operation could not be completed.";
  }
}

function userLabel(
  user: Pick<ConvexAdminUser, "id" | "name" | "email">
): string {
  return user.name ?? user.email ?? user.id;
}

function assignmentTypeLabel(type: ConvexAssignmentType): string {
  switch (type) {
    case "HOMEWORK":
      return "Homework";
    case "EXTRA_CREDIT":
      return "Extra credit";
    case "BONUS":
      return "Bonus";
  }
}

function statusClass(status: ConvexAssignmentWagerStatus): string {
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

function RatingSelector({
  allowNone,
  disabled,
  onChange,
  ratings,
  value,
}: {
  allowNone: boolean;
  disabled: boolean;
  onChange: (value: string | null) => void;
  ratings: ConvexAdminRating[];
  value: string | null;
}) {
  return (
    <select
      aria-label="Rating"
      className="h-9 rounded-md border bg-background px-3 text-sm"
      disabled={disabled}
      onChange={(event) =>
        onChange(event.target.value === "none" ? null : event.target.value)
      }
      value={value ?? "none"}
    >
      {allowNone && <option value="none">No rating</option>}
      {!allowNone && value === null && (
        <option value="none">Choose rating</option>
      )}
      {[...ratings]
        .sort((left, right) => right.value - left.value)
        .map((rating) => (
          <option key={rating.id} value={rating.id}>
            {rating.name} ({rating.value})
          </option>
        ))}
    </select>
  );
}

function ReviewCard({
  busy,
  onAddGuess,
  onRemoveGuess,
  onRemoveReview,
  onUpdateGuessRating,
  onUpdateRating,
  ratings,
  review,
}: {
  busy: string | null;
  onAddGuess: (review: ConvexAssignmentReview) => void;
  onRemoveGuess: (
    review: ConvexAssignmentReview,
    guess: ConvexAssignmentGuess
  ) => void;
  onRemoveReview: (review: ConvexAssignmentReview) => void;
  onUpdateGuessRating: (
    guess: ConvexAssignmentGuess,
    ratingId: string
  ) => void;
  onUpdateRating: (
    review: ConvexAssignmentReview,
    ratingId: string | null
  ) => void;
  ratings: ConvexAdminRating[];
  review: ConvexAssignmentReview;
}) {
  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-medium">
              {review.reviewer?.name ?? "Unknown reviewer"}
            </p>
            <p className="text-xs text-muted-foreground">
              {review.reviewedAt === null
                ? "No review timestamp"
                : formatInstantLocal(new Date(review.reviewedAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {review.rating !== null && (
            <RatingIcon value={review.rating.value} />
          )}
          <RatingSelector
            allowNone
            disabled={busy !== null}
            onChange={(ratingId) => onUpdateRating(review, ratingId)}
            ratings={ratings}
            value={review.rating?.id ?? null}
          />
          <Button
            disabled={busy !== null}
            onClick={() => onAddGuess(review)}
            size="sm"
            variant="outline"
          >
            <Plus className="mr-2 h-4 w-4" />
            Guess
          </Button>
          <Button
            disabled={busy !== null || review.guesses.length > 0}
            onClick={() => onRemoveReview(review)}
            size="icon"
            title={
              review.guesses.length > 0
                ? "Remove guesses before unlinking this review."
                : "Unlink assignment review"
            }
            variant="ghost"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      {review.guesses.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No guesses for this review.
        </p>
      ) : (
        <div className="space-y-2 border-l-2 pl-4">
          {review.guesses.map((guess) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
              key={guess.id}
            >
              <div className="flex items-center gap-3">
                <RatingIcon value={guess.rating.value} />
                <div>
                  <p className="text-sm font-medium">{guess.user.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {guess.season.title} ·{" "}
                    {formatInstantLocal(new Date(guess.createdAt), {
                      dateStyle: "medium",
                    })}
                  </p>
                </div>
                {guess.hasPoint && (
                  <Badge variant="secondary">Awarded</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <RatingSelector
                  allowNone={false}
                  disabled={busy !== null}
                  onChange={(ratingId) => {
                    if (ratingId !== null) {
                      onUpdateGuessRating(guess, ratingId);
                    }
                  }}
                  ratings={ratings}
                  value={guess.rating.id}
                />
                <Button
                  disabled={busy !== null || guess.hasPoint}
                  onClick={() => onRemoveGuess(review, guess)}
                  size="icon"
                  title={
                    guess.hasPoint
                      ? "Awarded guesses are preserved as scoring evidence."
                      : "Delete guess"
                  }
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WagerCard({
  busy,
  onStatus,
  wager,
}: {
  busy: string | null;
  onStatus: (
    wager: ConvexAssignmentWager,
    status: ConvexAssignmentWagerStatus
  ) => void;
  wager: ConvexAssignmentWager;
}) {
  const isActive = wager.status === "pending" || wager.status === "locked";
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{wager.user.name}</span>
          <Badge className={statusClass(wager.status)} variant="outline">
            {wager.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {wager.points} points × {wager.gamblingType.multiplier} ·{" "}
          {wager.gamblingType.title}
          {wager.targetUser === null
            ? ""
            : ` · target ${wager.targetUser.name ?? wager.targetUser.id}`}
        </p>
        {wager.awardAdjustment !== null && (
          <p className="text-sm text-emerald-700">
            Award adjustment: {wager.awardAdjustment}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {isActive && (
          <>
            <Button
              disabled={busy !== null}
              onClick={() => onStatus(wager, "won")}
              size="sm"
              variant="outline"
            >
              Won
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() => onStatus(wager, "lost")}
              size="sm"
              variant="outline"
            >
              Lost
            </Button>
          </>
        )}
        <Button
          disabled={busy !== null}
          onClick={() =>
            onStatus(
              wager,
              wager.status === "pending" ? "locked" : "pending"
            )
          }
          size="sm"
          variant="outline"
        >
          {wager.status === "pending"
            ? "Lock"
            : wager.status === "locked"
            ? "Unlock"
            : "Reset pending"}
        </Button>
      </div>
    </div>
  );
}

export function ConvexAssignmentDetailPage() {
  const client = useConvex();
  const router = useRouter();
  const slugParam = router.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
  const [workbench, setWorkbench] =
    useState<ConvexAssignmentWorkbench | null>(null);
  const [users, setUsers] = useState<ConvexAdminUser[]>([]);
  const [ratings, setRatings] = useState<ConvexAdminRating[]>([]);
  const [seasons, setSeasons] = useState<ConvexAdminSeason[]>([]);
  const [selectorsIncomplete, setSelectorsIncomplete] = useState(false);
  const [audio, setAudio] = useState<ConvexAssignmentAudioMessage[]>([]);
  const [audioCursor, setAudioCursor] = useState("");
  const [audioDone, setAudioDone] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [slugDraft, setSlugDraft] = useState("");
  const [typeDraft, setTypeDraft] =
    useState<ConvexAssignmentType>("HOMEWORK");
  const [playableDraft, setPlayableDraft] = useState(true);
  const [reviewUserId, setReviewUserId] = useState("");
  const [reviewRatingId, setReviewRatingId] = useState("none");
  const [guessReviewId, setGuessReviewId] = useState("");
  const [guessUserId, setGuessUserId] = useState("");
  const [guessRatingId, setGuessRatingId] = useState("");
  const [guessSeasonId, setGuessSeasonId] = useState("");

  const load = useCallback(async () => {
    if (slug === undefined || slug.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextWorkbench, userPage, nextRatings, seasonPage] =
        await Promise.all([
          loadConvexAssignmentWorkbench(client, slug),
          loadConvexAdminUsersPage(client, null),
          loadConvexAdminRatings(client),
          loadConvexAdminSeasonsPage(client, null),
        ]);
      setWorkbench(nextWorkbench);
      setUsers(userPage.users);
      setRatings(nextRatings);
      setSeasons(seasonPage.seasons);
      setSelectorsIncomplete(!userPage.isDone || !seasonPage.isDone);
      if (nextWorkbench !== null) {
        const audioPage = await loadConvexAssignmentAudioPage(
          client,
          nextWorkbench.assignment.id,
          null
        );
        setAudio(audioPage.messages);
        setAudioCursor(audioPage.continueCursor);
        setAudioDone(audioPage.isDone);
      } else {
        setAudio([]);
        setAudioCursor("");
        setAudioDone(true);
      }
    } catch (loadError) {
      setError(operationMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (workbench === null) {
      return;
    }
    setSlugDraft(workbench.assignment.slug ?? "");
    setTypeDraft(workbench.assignment.type);
    setPlayableDraft(workbench.assignment.playable);
    setGuessReviewId(workbench.reviews[0]?.id ?? "");
  }, [workbench]);

  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) =>
        userLabel(left).localeCompare(userLabel(right))
      ),
    [users]
  );

  async function runMutation(
    key: string,
    operation: () => Promise<void>,
    success: string
  ) {
    setBusy(key);
    try {
      await operation();
      toast.success(success);
      await load();
    } catch (mutationError) {
      toast.error(operationMessage(mutationError));
    } finally {
      setBusy(null);
    }
  }

  async function loadMoreAudio() {
    if (
      workbench === null ||
      audioDone ||
      loadingAudio ||
      audioCursor.length === 0
    ) {
      return;
    }
    setLoadingAudio(true);
    try {
      const page = await loadConvexAssignmentAudioPage(
        client,
        workbench.assignment.id,
        audioCursor
      );
      setAudio((current) => [...current, ...page.messages]);
      setAudioCursor(page.continueCursor);
      setAudioDone(page.isDone);
    } catch (audioError) {
      toast.error(operationMessage(audioError));
    } finally {
      setLoadingAudio(false);
    }
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
          <CardTitle>Assignment unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (workbench === null) {
    return (
      <Card className="mx-auto mt-12 max-w-xl">
        <CardHeader>
          <CardTitle>Assignment not found</CardTitle>
          <CardDescription>
            No canonical assignment matches this slug.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/episode">Back to episodes</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const { assignment } = workbench;
  const episodePath = assignment.episode.slug
    ? getAdminEpisodePath(assignment.episode.slug)
    : "/episode";

  return (
    <>
      <Head>
        <title>
          {assignmentTypeLabel(assignment.type)} assignment · BBPC Admin
        </title>
      </Head>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button asChild variant="ghost">
            <Link href={episodePath}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Episode {assignment.episode.number}
            </Link>
          </Button>
          <Button disabled={busy !== null} onClick={() => void load()}>
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                busy !== null && "animate-spin"
              )}
            />
            Refresh
          </Button>
        </div>

        <section className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">
                {assignmentTypeLabel(assignment.type)}
              </Badge>
              <Badge variant="secondary">
                Episode {assignment.episode.number}
              </Badge>
              {assignment.playable && <Badge>Playable</Badge>}
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              {assignment.movie.title}
            </h1>
            <p className="text-muted-foreground">
              Assigned to{" "}
              <span className="font-medium text-foreground">
                {assignment.user.name ?? assignment.user.id}
              </span>{" "}
              for {assignment.episode.title}.
            </p>
            {assignment.episode.status === "recording" &&
              assignment.episode.slug !== null && (
                <p className="text-sm text-muted-foreground">
                  This episode is currently recording.
                </p>
              )}
          </div>
          <Card className="overflow-hidden">
            {assignment.movie.poster !== null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="aspect-[2/3] w-full object-cover"
                src={assignment.movie.poster}
              />
            ) : (
              <div className="flex aspect-[2/3] items-center justify-center bg-muted">
                <Film className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
            <CardFooter className="grid gap-2 p-4">
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/movie/${encodeURIComponent(assignment.movie.id)}`}
                >
                  Movie details
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a
                  href={assignment.movie.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Catalog source
                  <ExternalLink className="ml-2 h-3 w-3" />
                </a>
              </Button>
            </CardFooter>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Assignment identity</CardTitle>
            <CardDescription>
              Slug, type, and playable writes include the exact loaded value so
              concurrent changes fail closed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="assignment-slug">Canonical slug</Label>
              <Input
                id="assignment-slug"
                onChange={(event) => setSlugDraft(event.target.value)}
                value={slugDraft}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to regenerate it from canonical relationships.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="assignment-type">Assignment type</Label>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                id="assignment-type"
                onChange={(event) =>
                  setTypeDraft(event.target.value as ConvexAssignmentType)
                }
                value={typeDraft}
              >
                <option value="HOMEWORK">Homework</option>
                <option value="EXTRA_CREDIT">Extra credit</option>
                <option value="BONUS">Bonus</option>
              </select>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-3 md:col-span-2">
              <Checkbox
                checked={playableDraft}
                id="assignment-playable"
                onCheckedChange={(checked) =>
                  setPlayableDraft(checked === true)
                }
              />
              <div className="grid gap-1">
                <Label htmlFor="assignment-playable">Playable</Label>
                <p className="text-xs text-muted-foreground">
                  Make this assignment available for gameplay.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3">
            <Button
              disabled={busy !== null}
              onClick={() => {
                if (
                  window.confirm(
                    "Delete this assignment only if it has no audio, points, syllabus, review, or wager references?"
                  )
                ) {
                  void runMutation(
                    "delete",
                    async () => {
                      await deleteConvexAssignment(client, assignment);
                      await router.push(episodePath);
                    },
                    "Assignment deleted"
                  );
                }
              }}
              variant="destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete if unreferenced
            </Button>
            <div className="flex gap-2">
              <Button
                disabled={
                  busy !== null ||
                  (slugDraft === (assignment.slug ?? "") &&
                    typeDraft === assignment.type &&
                    playableDraft === assignment.playable)
                }
                onClick={() => {
                  void runMutation(
                    "save",
                    async () => {
                      const updated = await updateConvexAssignmentIdentity(
                        client,
                        {
                          assignment,
                          slug: slugDraft,
                          type: typeDraft,
                          playable: playableDraft,
                        }
                      );
                      if (
                        updated.slug !== assignment.slug &&
                        updated.slug !== null
                      ) {
                        await router.replace(
                          getAdminAssignmentPath(updated.slug)
                        );
                      }
                    },
                    "Assignment updated"
                  );
                }}
              >
                <Save className="mr-2 h-4 w-4" />
                Save identity
              </Button>
            </div>
          </CardFooter>
        </Card>

        <Separator />

        <section className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <MessageSquare className="h-5 w-5" />
              Reviews and guesses
            </h2>
            <p className="text-sm text-muted-foreground">
              {workbench.reviews.length} bounded review relationship(s).
              Assignment review removal preserves the review record and is
              blocked while guesses exist.
            </p>
          </div>
          {selectorsIncomplete && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800">
              User or season selectors show only the first bounded page. Use
              the dedicated user or season tools when the desired record is
              not listed.
            </p>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add review</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="review-user">Reviewer</Label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  id="review-user"
                  onChange={(event) => setReviewUserId(event.target.value)}
                  value={reviewUserId}
                >
                  <option value="">Choose reviewer</option>
                  {sortedUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {userLabel(user)}
                      {user.status === "disabled" ? " (disabled)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="review-rating">Optional rating</Label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  id="review-rating"
                  onChange={(event) => setReviewRatingId(event.target.value)}
                  value={reviewRatingId}
                >
                  <option value="none">No rating</option>
                  {ratings.map((rating) => (
                    <option key={rating.id} value={rating.id}>
                      {rating.name} ({rating.value})
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button
                disabled={busy !== null || reviewUserId.length === 0}
                onClick={() =>
                  void runMutation(
                    "add-review",
                    async () => {
                      await createConvexAssignmentReview(client, {
                        assignmentId: assignment.id,
                        userId: reviewUserId,
                        ratingId:
                          reviewRatingId === "none"
                            ? null
                            : reviewRatingId,
                      });
                      setReviewUserId("");
                      setReviewRatingId("none");
                    },
                    "Assignment review added"
                  )
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add review
              </Button>
            </CardFooter>
          </Card>

          {workbench.reviews.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No assignment reviews.
            </p>
          ) : (
            workbench.reviews.map((review) => (
              <ReviewCard
                busy={busy}
                key={review.id}
                onAddGuess={(selectedReview) =>
                  setGuessReviewId(selectedReview.id)
                }
                onRemoveGuess={(selectedReview, guess) => {
                  if (
                    window.confirm(
                      "Delete this unawarded guess? Awarded guesses cannot be deleted."
                    )
                  ) {
                    void runMutation(
                      `remove-guess:${guess.id}`,
                      () =>
                        removeConvexAssignmentGuess(
                          client,
                          selectedReview.id,
                          guess
                        ),
                      "Guess deleted"
                    );
                  }
                }}
                onRemoveReview={(selectedReview) => {
                  if (
                    window.confirm(
                      "Unlink this assignment review? The review record itself will be preserved."
                    )
                  ) {
                    void runMutation(
                      `remove-review:${selectedReview.id}`,
                      () =>
                        removeConvexAssignmentReview(
                          client,
                          selectedReview.id
                        ),
                      "Assignment review unlinked"
                    );
                  }
                }}
                onUpdateGuessRating={(guess, ratingId) =>
                  void runMutation(
                    `guess-rating:${guess.id}`,
                    () =>
                      updateConvexAssignmentGuessRating(
                        client,
                        guess,
                        ratingId
                      ),
                    "Guess rating updated"
                  )
                }
                onUpdateRating={(selectedReview, ratingId) =>
                  void runMutation(
                    `review-rating:${selectedReview.id}`,
                    () =>
                      updateConvexAssignmentReviewRating(
                        client,
                        selectedReview,
                        ratingId
                      ),
                    "Review rating updated"
                  )
                }
                ratings={ratings}
                review={review}
              />
            ))
          )}

          {workbench.reviews.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Add guess</CardTitle>
                <CardDescription>
                  Each guess targets one assignment review, user, rating, and
                  season.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="guess-review">Review</Label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    id="guess-review"
                    onChange={(event) =>
                      setGuessReviewId(event.target.value)
                    }
                    value={guessReviewId}
                  >
                    {workbench.reviews.map((review) => (
                      <option key={review.id} value={review.id}>
                        {review.reviewer?.name ?? "Unknown reviewer"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="guess-user">Guesser</Label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    id="guess-user"
                    onChange={(event) =>
                      setGuessUserId(event.target.value)
                    }
                    value={guessUserId}
                  >
                    <option value="">Choose user</option>
                    {sortedUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {userLabel(user)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="guess-rating">Rating</Label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    id="guess-rating"
                    onChange={(event) =>
                      setGuessRatingId(event.target.value)
                    }
                    value={guessRatingId}
                  >
                    <option value="">Choose rating</option>
                    {ratings.map((rating) => (
                      <option key={rating.id} value={rating.id}>
                        {rating.name} ({rating.value})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="guess-season">Season</Label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    id="guess-season"
                    onChange={(event) =>
                      setGuessSeasonId(event.target.value)
                    }
                    value={guessSeasonId}
                  >
                    <option value="">Choose season</option>
                    {seasons.map((season) => (
                      <option key={season.id} value={season.id}>
                        {season.title}
                      </option>
                    ))}
                  </select>
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  disabled={
                    busy !== null ||
                    guessReviewId.length === 0 ||
                    guessUserId.length === 0 ||
                    guessRatingId.length === 0 ||
                    guessSeasonId.length === 0
                  }
                  onClick={() =>
                    void runMutation(
                      "add-guess",
                      async () => {
                        await createConvexAssignmentGuess(client, {
                          assignmentReviewId: guessReviewId,
                          userId: guessUserId,
                          ratingId: guessRatingId,
                          seasonId: guessSeasonId,
                        });
                        setGuessUserId("");
                        setGuessRatingId("");
                      },
                      "Guess added"
                    )
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add guess
                </Button>
              </CardFooter>
            </Card>
          )}
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <Headphones className="h-5 w-5" />
              Audio messages
            </h2>
            <p className="text-sm text-muted-foreground">
              Native 30-row pages. Externally keyed files remain protected
              until provider cleanup is integrated.
            </p>
          </div>
          {audio.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No assignment audio messages.
            </p>
          ) : (
            <div className="space-y-3">
              {audio.map((message) => (
                <div
                  className="flex flex-wrap items-center gap-4 rounded-lg border p-4"
                  key={message.id}
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {message.user.name ??
                          message.user.email ??
                          message.user.id}
                      </span>
                      <span>
                        {formatInstantLocal(new Date(message.createdAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                    </div>
                    <audio className="h-9 w-full" controls src={message.url}>
                      <track kind="captions" />
                    </audio>
                  </div>
                  <Button
                    disabled={busy !== null || message.fileKey !== null}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this audio metadata? This is available only when no external file key exists."
                        )
                      ) {
                        void runMutation(
                          `remove-audio:${message.id}`,
                          () =>
                            removeConvexAssignmentAudio(client, message),
                          "Audio metadata deleted"
                        );
                      }
                    }}
                    size="icon"
                    title={
                      message.fileKey === null
                        ? "Delete audio metadata"
                        : "External provider cleanup is required first."
                    }
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {!audioDone && (
            <Button
              disabled={loadingAudio}
              onClick={() => void loadMoreAudio()}
              variant="outline"
            >
              {loadingAudio && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Load more audio
            </Button>
          )}
        </section>

        <Separator />

        <section className="space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <Coins className="h-5 w-5" />
              Gambling wagers
            </h2>
            <p className="text-sm text-muted-foreground">
              {workbench.wagers.length} bounded wager(s). Status changes use
              the exact loaded status.
            </p>
          </div>
          {workbench.wagers.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No wagers for this assignment.
            </p>
          ) : (
            <div className="space-y-3">
              {workbench.wagers.map((wager) => (
                <WagerCard
                  busy={busy}
                  key={wager.id}
                  onStatus={(selectedWager, status) =>
                    void runMutation(
                      `wager:${selectedWager.id}`,
                      () =>
                        updateConvexAssignmentWagerStatus(
                          client,
                          selectedWager,
                          status
                        ),
                      "Wager status updated"
                    )
                  }
                  wager={wager}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
