import { useConvex } from "convex/react";
import {
  ArrowLeft,
  Calendar,
  Coins,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Trophy,
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

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexPointAssignment,
  type ConvexPointGamePointType,
  type ConvexPointWorkbench,
  deleteConvexPoint,
  linkConvexPointAssignment,
  loadConvexPointGamePointTypes,
  loadConvexPointWorkbench,
  searchConvexPointAssignments,
  unlinkConvexPointAssignment,
  updateConvexPoint,
} from "@/convex/pointDetails";
import { formatInstantLocal } from "@/lib/dates";
import { getAdminAssignmentPath } from "@/lib/routes";
import { cn } from "@/lib/utils";

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
import { ConfirmModal } from "../ui/confirm-modal";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

function operationMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The point or one of its relationships changed. Refresh before retrying.";
    case "VALIDATION_FAILED":
      return "Check the reason, adjustment, point type, and assignment search.";
    case "WRITE_DISABLED":
      return "Point changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    case "NOT_FOUND":
      return "The point or related record is no longer available.";
    default:
      return "The point operation could not be completed.";
  }
}

function assignmentLabel(assignment: ConvexPointAssignment): string {
  return `${assignment.movie.title} · Episode ${assignment.episode.number}`;
}

export function ConvexPointDetailPage() {
  const client = useConvex();
  const router = useRouter();
  const idParam = router.query.id;
  const pointId = Array.isArray(idParam) ? idParam[0] : idParam;
  const [workbench, setWorkbench] =
    useState<ConvexPointWorkbench | null>(null);
  const [pointTypes, setPointTypes] = useState<
    ConvexPointGamePointType[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [adjustmentDraft, setAdjustmentDraft] = useState("");
  const [pointTypeIdDraft, setPointTypeIdDraft] = useState("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    ConvexPointAssignment[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (pointId === undefined || pointId.length === 0) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextWorkbench, nextPointTypes] = await Promise.all([
        loadConvexPointWorkbench(client, pointId),
        loadConvexPointGamePointTypes(client),
      ]);
      setWorkbench(nextWorkbench);
      setPointTypes(nextPointTypes);
    } catch (loadError) {
      setError(operationMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, pointId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (workbench === null) {
      return;
    }
    setReasonDraft(workbench.point.reason ?? "");
    setAdjustmentDraft(
      workbench.point.adjustment === null
        ? ""
        : String(workbench.point.adjustment)
    );
    setPointTypeIdDraft(workbench.point.gamePointType?.id ?? "none");
  }, [workbench]);

  const selectedPointType = useMemo(
    () =>
      pointTypes.find((pointType) => pointType.id === pointTypeIdDraft) ??
      null,
    [pointTypeIdDraft, pointTypes]
  );
  const parsedAdjustment =
    adjustmentDraft.trim().length === 0
      ? null
      : Number(adjustmentDraft);
  const previewTotal =
    (selectedPointType?.points ?? 0) +
    (Number.isSafeInteger(parsedAdjustment) ? parsedAdjustment ?? 0 : 0);

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

  async function runSearch() {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(
        await searchConvexPointAssignments(client, query)
      );
    } catch (searchError) {
      toast.error(operationMessage(searchError));
      setSearchResults([]);
    } finally {
      setSearching(false);
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
          <CardTitle>Point unavailable</CardTitle>
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
          <CardTitle>Point not found</CardTitle>
          <CardDescription>
            No canonical point matches this identifier.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/game">Back to game administration</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const { point, impact, guessAssignments } = workbench;
  const linkedAssignmentIds = new Set(
    point.assignmentLinks.map((link) => link.assignment.id)
  );
  const seasonPath = `/season/${encodeURIComponent(point.season.id)}`;
  const deleteDescription = [
    `${impact.assignmentLinkCount} assignment link(s)`,
    `${impact.guessCount} guess award(s)`,
    `${impact.gamblingEntryCount} gambling award(s)`,
    `${impact.tagVoteCount} tag-vote award(s)`,
    `${impact.quoteSubmissionCount} quote award(s)`,
  ].join(", ");

  return (
    <>
      <Head>
        <title>Point for {point.user.name ?? point.user.id} · BBPC Admin</title>
      </Head>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link href={seasonPath}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {point.season.title}
            </Link>
          </Button>
          <Button
            disabled={busy !== null}
            onClick={() => void load()}
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                loading && "animate-spin"
              )}
            />
            Refresh
          </Button>
        </div>

        <section className="grid gap-6 md:grid-cols-[1fr_280px]">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {point.gamePointType?.title ?? "Manual point"}
                </Badge>
                <Badge variant="outline">{point.total} points</Badge>
              </div>
              <CardTitle className="pt-2">Edit point record</CardTitle>
              <CardDescription>
                Saves include the exact loaded point values so concurrent
                changes fail closed.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="point-reason">Reason</Label>
                <Input
                  id="point-reason"
                  maxLength={1000}
                  onChange={(event) => setReasonDraft(event.target.value)}
                  placeholder="Manual adjustment or award reason"
                  value={reasonDraft}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="point-adjustment">Adjustment</Label>
                  <Input
                    id="point-adjustment"
                    inputMode="numeric"
                    onChange={(event) =>
                      setAdjustmentDraft(event.target.value)
                    }
                    placeholder="No adjustment"
                    type="number"
                    value={adjustmentDraft}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="point-type">Point type</Label>
                  <select
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    id="point-type"
                    onChange={(event) =>
                      setPointTypeIdDraft(event.target.value)
                    }
                    value={pointTypeIdDraft}
                  >
                    <option value="none">None / manual</option>
                    {pointTypes.map((pointType) => (
                      <option key={pointType.id} value={pointType.id}>
                        {pointType.title} ({pointType.points})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Preview total
                  </p>
                  <p className="text-2xl font-bold">{previewTotal} points</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy !== null}
                    onClick={() => setConfirmDelete(true)}
                    variant="destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                  <Button
                    disabled={
                      busy !== null ||
                      (adjustmentDraft.trim().length > 0 &&
                        !Number.isSafeInteger(parsedAdjustment))
                    }
                    onClick={() => {
                      void runMutation(
                        "save",
                        () =>
                          updateConvexPoint(client, point, {
                            reason:
                              reasonDraft.trim().length === 0
                                ? null
                                : reasonDraft,
                            adjustment: parsedAdjustment,
                            gamePointTypeId:
                              pointTypeIdDraft === "none"
                                ? null
                                : pointTypeIdDraft,
                          }),
                        "Point updated"
                      );
                    }}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save changes
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
                Context
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4" />
                  <span className="font-medium">
                    {point.user.name ?? "Unnamed user"}
                  </span>
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {point.user.id}
                </p>
              </div>
              <Link
                className="flex items-center gap-2 rounded-md bg-muted/50 p-3 font-medium hover:bg-muted"
                href={seasonPath}
              >
                <Trophy className="h-4 w-4 text-amber-600" />
                {point.season.title}
              </Link>
              <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm">
                <Calendar className="h-4 w-4" />
                {formatInstantLocal(new Date(point.earnedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Linked assignments</CardTitle>
            <CardDescription>
              Search is bounded to 30 assignments by movie title, episode
              title, or exact episode number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  maxLength={100}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runSearch();
                    }
                  }}
                  placeholder="Movie, episode title, or episode number"
                  value={searchQuery}
                />
              </div>
              <Button
                disabled={searching || searchQuery.trim().length < 2}
                onClick={() => void runSearch()}
                variant="outline"
              >
                {searching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="grid gap-2 rounded-lg border bg-muted/20 p-3">
                {searchResults.map((assignment) => {
                  const linked = linkedAssignmentIds.has(assignment.id);
                  return (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background p-3"
                      key={assignment.id}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {assignmentLabel(assignment)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {assignment.user.name ?? assignment.user.id}
                        </p>
                      </div>
                      <Button
                        disabled={busy !== null || linked}
                        onClick={() => {
                          void runMutation(
                            `link:${assignment.id}`,
                            () =>
                              linkConvexPointAssignment(
                                client,
                                point.id,
                                assignment.id
                              ),
                            "Assignment linked"
                          );
                        }}
                        size="sm"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {linked ? "Linked" : "Link"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid gap-2">
              {point.assignmentLinks.map((link) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                  key={link.id}
                >
                  <div>
                    <p className="font-medium">
                      {assignmentLabel(link.assignment)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Assigned to{" "}
                      {link.assignment.user.name ?? link.assignment.user.id}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={getAdminAssignmentPath(
                          link.assignment.slug ?? link.assignment.id
                        )}
                      >
                        View
                      </Link>
                    </Button>
                    <Button
                      disabled={busy !== null}
                      onClick={() => {
                        void runMutation(
                          `unlink:${link.id}`,
                          () =>
                            unlinkConvexPointAssignment(
                              client,
                              point.id,
                              link
                            ),
                          "Assignment unlinked"
                        );
                      }}
                      size="icon"
                      title="Unlink assignment"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              {point.assignmentLinks.length === 0 && (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No assignments are directly linked.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked activity</CardTitle>
            <CardDescription>
              Canonical scoring evidence that will be detached, not erased,
              if this point is deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {guessAssignments.map((guess) => (
              <div className="rounded-lg border p-4" key={guess.id}>
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 text-orange-500" />
                  <div>
                    <p className="font-medium">Guess award</p>
                    <Link
                      className="text-sm text-primary hover:underline"
                      href={getAdminAssignmentPath(
                        guess.assignment.slug ?? guess.assignment.id
                      )}
                    >
                      {assignmentLabel(guess.assignment)}
                    </Link>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {guess.id}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {point.tagVotes.map((vote) => (
              <div className="rounded-lg border p-4" key={vote.id}>
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 text-purple-500" />
                  <div>
                    <p className="font-medium">Tag vote: {vote.tag}</p>
                    <Link
                      className="text-sm text-primary hover:underline"
                      href={`/tag?name=${encodeURIComponent(vote.tag)}`}
                    >
                      View tag votes
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            {point.gamblingEntries.map((entry) => (
              <div className="rounded-lg border p-4" key={entry.id}>
                <div className="flex items-start gap-3">
                  <Coins className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <div>
                    <p className="font-medium">Gambling award</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {entry.id}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {point.quoteSubmissions.map((quote) => (
              <div className="rounded-lg border p-4" key={quote.id}>
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 text-blue-500" />
                  <div>
                    <p className="font-medium">Quote award</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {quote.id}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {impact.guessCount === 0 &&
              impact.gamblingEntryCount === 0 &&
              impact.tagVoteCount === 0 &&
              impact.quoteSubmissionCount === 0 && (
                <p className="md:col-span-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No scoring activity is attached to this point.
                </p>
              )}
          </CardContent>
        </Card>
      </main>

      <ConfirmModal
        confirmText="Delete point"
        description={`This exact confirmation covers ${deleteDescription}. The related activity will remain, but its point award will be cleared. Any relationship drift will cancel deletion.`}
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setBusy("delete");
          void deleteConvexPoint(client, workbench)
            .then(async () => {
              toast.success("Point deleted");
              await router.push(seasonPath);
            })
            .catch((deleteError: unknown) => {
              toast.error(operationMessage(deleteError));
            })
            .finally(() => setBusy(null));
        }}
        title="Delete this point record?"
      />
    </>
  );
}
