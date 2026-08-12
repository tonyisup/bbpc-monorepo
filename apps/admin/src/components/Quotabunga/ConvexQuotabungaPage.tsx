import { useConvex } from "convex/react";
import {
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Shuffle,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  awardConvexAdminQuotePlacements,
  createConvexAdminQuoteForUser,
  deleteConvexAdminQuote,
  loadConvexAdminQuoteEpisodes,
  loadConvexAdminQuoteSubmissions,
  randomizeConvexAdminQuotes,
  setConvexAdminQuoteStatus,
  snapshotConvexQuoteAwards,
  updateConvexAdminQuoteContent,
  type ConvexAdminQuoteEpisode,
  type ConvexAdminQuoteSubmission,
  type ConvexQuoteAwardSnapshot,
  type ConvexQuotePlacement,
  type ConvexQuotePlacementInput,
  type ConvexQuoteSourceType,
  type ConvexQuoteStatus,
} from "@/convex/quotabunga";
import {
  loadConvexAdminUsersPage,
  type ConvexAdminUser,
} from "@/convex/users";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

interface QuoteFormState {
  userId: string;
  quoteText: string;
  sourceTitle: string;
  sourceType: ConvexQuoteSourceType;
  clipUrl: string;
  clipStartSeconds: string;
  listenerNotes: string;
  adminNotes: string;
}

interface PendingAwards {
  placements: ConvexQuotePlacementInput[];
  expectedAwards: ConvexQuoteAwardSnapshot[];
  replacedCount: number;
}

const emptyForm: QuoteFormState = {
  userId: "",
  quoteText: "",
  sourceTitle: "",
  sourceType: "MOVIE",
  clipUrl: "",
  clipStartSeconds: "",
  listenerNotes: "",
  adminNotes: "",
};

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function currentLocalDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function writeFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "Quotabunga state changed. Refresh and inspect the round before retrying.";
    case "NOT_FOUND":
      return "The Quotabunga entry or one of its relationships is unavailable.";
    case "VALIDATION_FAILED":
      return "The Quotabunga request did not pass validation.";
    case "WRITE_DISABLED":
      return "Quotabunga changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The Quotabunga change could not be completed.";
  }
}

function submissionLabel(submission: ConvexAdminQuoteSubmission): string {
  return (
    submission.user.name ??
    submission.user.email ??
    "Unknown listener"
  );
}

function awardSnapshotMatchesDraft(
  snapshot: ConvexQuoteAwardSnapshot,
  placements: ConvexQuotePlacementInput[]
): boolean {
  const placement = placements.find(
    (item) => item.submissionId === snapshot.submissionId
  );
  return placement?.placement === snapshot.placement;
}

export function ConvexQuotabungaPage() {
  const convex = useConvex();
  const router = useRouter();
  const [episodes, setEpisodes] = useState<
    ConvexAdminQuoteEpisode[] | null
  >(null);
  const [users, setUsers] = useState<ConvexAdminUser[] | null>(null);
  const [userCatalogComplete, setUserCatalogComplete] = useState(true);
  const [episodeId, setEpisodeId] = useState("");
  const [submissions, setSubmissions] = useState<
    ConvexAdminQuoteSubmission[] | null
  >(null);
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | ConvexQuoteStatus
  >("ALL");
  const [search, setSearch] = useState("");
  const [bracketSeed, setBracketSeed] = useState("");
  const [placements, setPlacements] = useState<
    Record<string, ConvexQuotePlacement | null>
  >({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] =
    useState<ConvexAdminQuoteSubmission | null>(null);
  const [form, setForm] = useState<QuoteFormState>(emptyForm);
  const [pendingDelete, setPendingDelete] =
    useState<ConvexAdminQuoteSubmission | null>(null);
  const [pendingAwards, setPendingAwards] =
    useState<PendingAwards | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void Promise.all([
      loadConvexAdminQuoteEpisodes(convex),
      loadConvexAdminUsersPage(convex, null),
    ])
      .then(([loadedEpisodes, userPage]) => {
        if (!active) {
          return;
        }
        setEpisodes(loadedEpisodes);
        setUsers(userPage.users);
        setUserCatalogComplete(userPage.isDone);
        setEpisodeId((current) => {
          const requested =
            typeof router.query.episodeId === "string"
              ? router.query.episodeId
              : "";
          if (
            requested.length > 0 &&
            loadedEpisodes.some((episode) => episode.id === requested)
          ) {
            return requested;
          }
          if (
            current.length > 0 &&
            loadedEpisodes.some((episode) => episode.id === current)
          ) {
            return current;
          }
          return (
            loadedEpisodes.find((episode) => episode.status === "next")
              ?.id ??
            loadedEpisodes.find(
              (episode) => episode.status === "recording"
            )?.id ??
            loadedEpisodes[0]?.id ??
            ""
          );
        });
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, revision, router.query.episodeId]);

  useEffect(() => {
    if (episodeId.length === 0) {
      setSubmissions([]);
      return;
    }
    let active = true;
    setSubmissions(null);
    setLoadFailed(false);
    void loadConvexAdminQuoteSubmissions(convex, episodeId)
      .then((loadedSubmissions) => {
        if (!active) {
          return;
        }
        setSubmissions(loadedSubmissions);
        setPlacements(
          Object.fromEntries(
            loadedSubmissions.map((submission) => [
              submission.id,
              submission.placement,
            ])
          )
        );
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, episodeId, revision]);

  useEffect(() => {
    const episode = episodes?.find((item) => item.id === episodeId);
    if (episode !== undefined) {
      setBracketSeed(`quotabunga-${String(episode.number)}`);
    }
  }, [episodeId, episodes]);

  const refresh = () => {
    setSubmissions(null);
    setRevision((value) => value + 1);
  };

  const visibleSubmissions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (submissions ?? []).filter((submission) => {
      if (
        statusFilter !== "ALL" &&
        submission.status !== statusFilter
      ) {
        return false;
      }
      if (needle.length === 0) {
        return true;
      }
      return [
        submission.quoteText,
        submission.sourceTitle,
        submission.user.name,
        submission.user.email,
      ].some((value) => value?.toLocaleLowerCase().includes(needle));
    });
  }, [search, statusFilter, submissions]);

  const counts = useMemo(
    () => ({
      all: submissions?.length ?? 0,
      submitted:
        submissions?.filter(
          (submission) => submission.status === "SUBMITTED"
        ).length ?? 0,
      included:
        submissions?.filter(
          (submission) => submission.status === "INCLUDED"
        ).length ?? 0,
      rejected:
        submissions?.filter(
          (submission) => submission.status === "REJECTED"
        ).length ?? 0,
    }),
    [submissions]
  );

  const availableUsers = useMemo(() => {
    const submittedUserIds = new Set(
      submissions?.map((submission) => submission.userId) ?? []
    );
    return (
      users?.filter((user) => !submittedUserIds.has(user.id)) ?? []
    );
  }, [submissions, users]);

  const runWrite = (
    key: string,
    action: () => Promise<unknown>,
    successMessage: string
  ) => {
    if (busyAction !== null) {
      return;
    }
    setBusyAction(key);
    void action()
      .then(() => {
        toast.success(successMessage);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setBusyAction(null));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (submission: ConvexAdminQuoteSubmission) => {
    setEditing(submission);
    setForm({
      userId: submission.userId,
      quoteText: submission.quoteText,
      sourceTitle: submission.sourceTitle,
      sourceType: submission.sourceType,
      clipUrl: submission.clipUrl ?? "",
      clipStartSeconds: submission.clipStartSeconds?.toString() ?? "",
      listenerNotes: submission.listenerNotes ?? "",
      adminNotes: submission.adminNotes ?? "",
    });
    setModalOpen(true);
  };

  const saveSubmission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyAction !== null) {
      return;
    }
    const clipStartSeconds =
      form.clipStartSeconds.length === 0
        ? null
        : Number(form.clipStartSeconds);
    if (
      clipStartSeconds !== null &&
      (!Number.isInteger(clipStartSeconds) ||
        clipStartSeconds < 0 ||
        clipStartSeconds > 86_400)
    ) {
      toast.error("Clip start must be a whole number from 0 to 86400.");
      return;
    }
    const content = {
      quoteText: form.quoteText,
      sourceTitle: form.sourceTitle,
      sourceType: form.sourceType,
      clipUrl: nullableText(form.clipUrl),
      clipStartSeconds,
      listenerNotes: nullableText(form.listenerNotes),
    };
    setBusyAction("save");
    const request =
      editing === null
        ? createConvexAdminQuoteForUser(convex, {
            ...content,
            episodeId,
            userId: form.userId,
            today: currentLocalDate(),
          })
        : updateConvexAdminQuoteContent(convex, {
            ...content,
            id: editing.id,
            adminNotes: nullableText(form.adminNotes),
          });
    void request
      .then(() => {
        toast.success(
          editing === null ? "Submission added." : "Submission updated."
        );
        setModalOpen(false);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setBusyAction(null));
  };

  const changePlacement = (
    submissionId: string,
    placement: ConvexQuotePlacement | null
  ) => {
    setPlacements((current) => {
      const next = { ...current };
      if (placement !== null) {
        for (const [id, currentPlacement] of Object.entries(next)) {
          if (currentPlacement === placement && id !== submissionId) {
            next[id] = null;
          }
        }
      }
      next[submissionId] = placement;
      return next;
    });
  };

  const preflightAwards = () => {
    if (submissions === null) {
      return;
    }
    const includedIds = new Set(
      submissions
        .filter((submission) => submission.status === "INCLUDED")
        .map((submission) => submission.id)
    );
    const nextPlacements = Object.entries(placements)
      .filter(
        (entry): entry is [string, ConvexQuotePlacement] =>
          entry[1] !== null && includedIds.has(entry[0])
      )
      .map(([submissionId, placement]) => ({
        submissionId,
        placement,
      }));
    const expectedAwards = snapshotConvexQuoteAwards(submissions);
    const replacedCount = expectedAwards.filter(
      (snapshot) =>
        !awardSnapshotMatchesDraft(snapshot, nextPlacements)
    ).length;
    setPendingAwards({
      placements: nextPlacements,
      expectedAwards,
      replacedCount,
    });
  };

  const saveAwards = () => {
    if (pendingAwards === null) {
      return;
    }
    const pending = pendingAwards;
    setPendingAwards(null);
    setBusyAction("awards");
    void awardConvexAdminQuotePlacements(
      convex,
      episodeId,
      pending.placements,
      pending.expectedAwards
    )
      .then((result) => {
        toast.success(
          `Saved ${String(result.awarded)} result${
            result.awarded === 1 ? "" : "s"
          }; cleared ${String(result.cleared)} prior award${
            result.cleared === 1 ? "" : "s"
          }.`
        );
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setBusyAction(null));
  };

  const deleteSubmission = () => {
    if (pendingDelete === null) {
      return;
    }
    const target = pendingDelete;
    setPendingDelete(null);
    runWrite(
      `delete-${target.id}`,
      async () => await deleteConvexAdminQuote(convex, target),
      "Submission removed."
    );
  };

  return (
    <>
      <Head>
        <title>Quotabunga - BBPC Admin</title>
      </Head>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-black tracking-tight">
              <Quote className="h-8 w-8 text-primary" /> Quotabunga
            </h1>
            <p className="mt-1 text-muted-foreground">
              Moderate bounded episode entries, seed the bracket, and award
              owned result points.
            </p>
          </div>
          <Button
            disabled={
              episodeId.length === 0 ||
              users === null ||
              busyAction !== null
            }
            onClick={openCreate}
          >
            <Plus className="mr-2 h-4 w-4" /> Add for listener
          </Button>
        </div>

        {loadFailed ? (
          <Card className="p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Quotabunga could not be loaded. No legacy SQL fallback was
              attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </Card>
        ) : (
          <>
            <Card className="grid gap-4 p-5 lg:grid-cols-[minmax(16rem,1fr)_minmax(14rem,1fr)_minmax(14rem,1fr)_auto]">
              <div className="space-y-2">
                <label
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                  htmlFor="episode-filter"
                >
                  Episode
                </label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  id="episode-filter"
                  onChange={(event) => setEpisodeId(event.target.value)}
                  value={episodeId}
                >
                  {episodes?.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      #{episode.number} · {episode.title} (
                      {episode.submissionCount})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                  htmlFor="quote-search"
                >
                  Search
                </label>
                <Input
                  id="quote-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Listener, source, or quote..."
                  value={search}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                  htmlFor="bracket-seed"
                >
                  Bracket seed
                </label>
                <Input
                  id="bracket-seed"
                  maxLength={100}
                  onChange={(event) => setBracketSeed(event.target.value)}
                  value={bracketSeed}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  disabled={
                    counts.included === 0 ||
                    bracketSeed.trim().length === 0 ||
                    busyAction !== null
                  }
                  onClick={() =>
                    runWrite(
                      "randomize",
                      async () =>
                        await randomizeConvexAdminQuotes(
                          convex,
                          episodeId,
                          bracketSeed
                        ),
                      "Included entries randomized from the visible seed."
                    )
                  }
                  variant="outline"
                >
                  {busyAction === "randomize" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shuffle className="mr-2 h-4 w-4" />
                  )}
                  Randomize
                </Button>
                <Button
                  disabled={counts.included === 0 || busyAction !== null}
                  onClick={preflightAwards}
                >
                  {busyAction === "awards" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trophy className="mr-2 h-4 w-4" />
                  )}
                  Award
                </Button>
              </div>
            </Card>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["ALL", `All ${String(counts.all)}`],
                  [
                    "SUBMITTED",
                    `Submitted ${String(counts.submitted)}`,
                  ],
                  ["INCLUDED", `Included ${String(counts.included)}`],
                  ["REJECTED", `Rejected ${String(counts.rejected)}`],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  size="sm"
                  variant={statusFilter === value ? "default" : "outline"}
                >
                  {label}
                </Button>
              ))}
            </div>

            {submissions === null ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : visibleSubmissions.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                No Quotabunga submissions match this view.
              </Card>
            ) : (
              <div className="grid gap-4">
                {visibleSubmissions.map((submission) => (
                  <Card className="overflow-hidden p-5" key={submission.id}>
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_14rem]">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              submission.status === "INCLUDED"
                                ? "default"
                                : "outline"
                            }
                          >
                            {submission.status}
                          </Badge>
                          {submission.bracketOrder !== null && (
                            <Badge variant="outline">
                              Bracket #{submission.bracketOrder}
                            </Badge>
                          )}
                          {submission.placement !== null && (
                            <Badge variant="outline">
                              Place #{submission.placement} ·{" "}
                              {submission.point?.adjustment ?? 0} points
                            </Badge>
                          )}
                          <span className="text-sm font-semibold">
                            {submissionLabel(submission)}
                          </span>
                        </div>
                        <blockquote className="whitespace-pre-wrap text-lg font-medium">
                          &ldquo;{submission.quoteText}&rdquo;
                        </blockquote>
                        <p className="text-sm text-muted-foreground">
                          {submission.sourceTitle} · {submission.sourceType}
                        </p>
                        {submission.listenerNotes !== null && (
                          <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                            Listener: {submission.listenerNotes}
                          </p>
                        )}
                        {submission.adminNotes !== null && (
                          <p className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-600">
                            Admin: {submission.adminNotes}
                          </p>
                        )}
                        {submission.clipUrl !== null && (
                          <a
                            className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline"
                            href={submission.clipUrl}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            Open clip
                            {submission.clipStartSeconds === null
                              ? ""
                              : ` at ${String(
                                  submission.clipStartSeconds
                                )}s`}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>

                      <div className="flex flex-col justify-between gap-4 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                        {submission.status === "INCLUDED" && (
                          <div className="space-y-2">
                            <label
                              className="text-xs font-bold uppercase text-muted-foreground"
                              htmlFor={`placement-${submission.id}`}
                            >
                              Placement
                            </label>
                            <select
                              className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                              id={`placement-${submission.id}`}
                              onChange={(event) =>
                                changePlacement(
                                  submission.id,
                                  event.target.value.length === 0
                                    ? null
                                    : (Number(
                                        event.target.value
                                      ) as ConvexQuotePlacement)
                                )
                              }
                              value={
                                placements[submission.id]?.toString() ?? ""
                              }
                            >
                              <option value="">No placement</option>
                              <option value="1">1st · 40 points</option>
                              <option value="2">2nd · 20 points</option>
                              <option value="3">3rd · 10 points</option>
                            </select>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          {submission.status !== "INCLUDED" && (
                            <Button
                              disabled={busyAction !== null}
                              onClick={() =>
                                runWrite(
                                  `status-${submission.id}`,
                                  async () =>
                                    await setConvexAdminQuoteStatus(
                                      convex,
                                      submission.id,
                                      "INCLUDED"
                                    ),
                                  "Submission included."
                                )
                              }
                              size="sm"
                            >
                              <Check className="mr-1 h-4 w-4" /> Include
                            </Button>
                          )}
                          {submission.status !== "REJECTED" && (
                            <Button
                              disabled={busyAction !== null}
                              onClick={() =>
                                runWrite(
                                  `status-${submission.id}`,
                                  async () =>
                                    await setConvexAdminQuoteStatus(
                                      convex,
                                      submission.id,
                                      "REJECTED"
                                    ),
                                  "Submission rejected."
                                )
                              }
                              size="sm"
                              variant="outline"
                            >
                              <X className="mr-1 h-4 w-4" /> Reject
                            </Button>
                          )}
                          {submission.status !== "SUBMITTED" &&
                            !submission.scored && (
                              <Button
                                disabled={busyAction !== null}
                                onClick={() =>
                                  runWrite(
                                    `status-${submission.id}`,
                                    async () =>
                                      await setConvexAdminQuoteStatus(
                                        convex,
                                        submission.id,
                                        "SUBMITTED"
                                      ),
                                    "Submission reset."
                                  )
                                }
                                size="sm"
                                variant="outline"
                              >
                                Reset
                              </Button>
                            )}
                          <Button
                            disabled={
                              submission.scored || busyAction !== null
                            }
                            onClick={() => openEdit(submission)}
                            size="sm"
                            variant="outline"
                          >
                            <Pencil className="mr-1 h-4 w-4" /> Edit
                          </Button>
                          <Button
                            disabled={busyAction !== null}
                            onClick={() => setPendingDelete(submission)}
                            size="sm"
                            variant="destructive"
                          >
                            <Trash2 className="mr-1 h-4 w-4" /> Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog onOpenChange={setModalOpen} open={modalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing === null
                ? "Add Quotabunga entry"
                : "Edit Quotabunga entry"}
            </DialogTitle>
            <DialogDescription>
              {editing === null
                ? "Import an entry or add one on a listener’s behalf."
                : "Correct submission content or private administrator notes."}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveSubmission}>
            {editing === null && (
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="listener">
                  Listener
                </label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  id="listener"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      userId: event.target.value,
                    }))
                  }
                  required
                  value={form.userId}
                >
                  <option value="">Choose a listener...</option>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name ?? user.email ?? "Unnamed user"}
                    </option>
                  ))}
                </select>
                {!userCatalogComplete && (
                  <p className="text-xs text-amber-600">
                    Listener selector shows the first 50 users.
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-semibold" htmlFor="quoteText">
                Quote or scene
              </label>
              <Textarea
                className="min-h-28"
                id="quoteText"
                maxLength={2000}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    quoteText: event.target.value,
                  }))
                }
                required
                value={form.quoteText}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold"
                  htmlFor="sourceTitle"
                >
                  Movie or show
                </label>
                <Input
                  id="sourceTitle"
                  maxLength={500}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceTitle: event.target.value,
                    }))
                  }
                  required
                  value={form.sourceTitle}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold"
                  htmlFor="sourceType"
                >
                  Type
                </label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  id="sourceType"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceType: event.target
                        .value as ConvexQuoteSourceType,
                    }))
                  }
                  value={form.sourceType}
                >
                  <option value="MOVIE">Movie</option>
                  <option value="TV">Television</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="clipUrl">
                  Clip URL
                </label>
                <Input
                  id="clipUrl"
                  maxLength={2000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      clipUrl: event.target.value,
                    }))
                  }
                  type="url"
                  value={form.clipUrl}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold"
                  htmlFor="clipStart"
                >
                  Start second
                </label>
                <Input
                  id="clipStart"
                  max={86_400}
                  min={0}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      clipStartSeconds: event.target.value,
                    }))
                  }
                  type="number"
                  value={form.clipStartSeconds}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-semibold"
                htmlFor="listenerNotes"
              >
                Listener notes
              </label>
              <Textarea
                id="listenerNotes"
                maxLength={1000}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    listenerNotes: event.target.value,
                  }))
                }
                value={form.listenerNotes}
              />
            </div>
            {editing !== null && (
              <div className="space-y-2">
                <label
                  className="text-sm font-semibold"
                  htmlFor="adminNotes"
                >
                  Private admin notes
                </label>
                <Textarea
                  id="adminNotes"
                  maxLength={1000}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      adminNotes: event.target.value,
                    }))
                  }
                  value={form.adminNotes}
                />
              </div>
            )}
            <DialogFooter>
              <Button
                disabled={busyAction !== null}
                onClick={() => setModalOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  busyAction !== null ||
                  form.quoteText.trim().length === 0 ||
                  form.sourceTitle.trim().length === 0 ||
                  (editing === null && form.userId.length === 0)
                }
                type="submit"
              >
                {busyAction === "save" && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        confirmText="Save awards"
        description={
          pendingAwards === null
            ? ""
            : `This will save ${String(
                pendingAwards.placements.length
              )} placement${
                pendingAwards.placements.length === 1 ? "" : "s"
              } and replace or clear ${String(
                pendingAwards.replacedCount
              )} prior award${
                pendingAwards.replacedCount === 1 ? "" : "s"
              }. The exact inspected award state must still match.`
        }
        isOpen={pendingAwards !== null}
        onClose={() => setPendingAwards(null)}
        onConfirm={saveAwards}
        title="Replace Quotabunga awards?"
        variant="default"
      />

      <ConfirmModal
        confirmText="Delete submission"
        description={
          pendingDelete === null
            ? ""
            : `Delete ${submissionLabel(pendingDelete)}’s submission${
                pendingDelete.point === null
                  ? ""
                  : " and its owned award point"
              }? The exact inspected award state must still match.`
        }
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={deleteSubmission}
        title="Delete Quotabunga submission?"
      />
    </>
  );
}
