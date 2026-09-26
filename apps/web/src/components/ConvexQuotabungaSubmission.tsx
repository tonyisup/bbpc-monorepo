"use client";

import { formatTranscriptTime } from "@bbpc/episode-search";
import { api } from "@tonyisup/bbpc-convex-api";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { useConvex, useQuery } from "convex/react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { QuotabungaClipFields } from "@/components/QuotabungaClipFields";
import {
  formatClipTime,
  MAX_CLIP_SECONDS,
  MAX_QUOTE_TEXT_LENGTH,
  parseYouTubeUrl,
  validClipRange,
  youtubeWatchUrl,
} from "@/lib/quoteClip";
import { AdminCollapsibleHeader } from "@/components/AdminCollapsibleHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConvexCurrentQuoteSubmission,
  type ConvexQuoteSourceType,
  type ConvexQuoteTranscriptMatch,
  checkConvexQuotabungaDuplicate,
  loadConvexQuotabunga,
  submitConvexQuotabunga,
  withdrawConvexQuotabunga,
} from "@/convex/quotabunga";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { useAdminCollapse } from "@/hooks/useAdminCollapse";
import {
  PredictionRoundState,
  getPredictionRoundState,
} from "@/lib/predictionRound.mjs";
import { getEpisodePath } from "@/lib/routes";
import { cn } from "@/lib/utils";

const QUOTE_DUPLICATE_CHECK_DELAY_MS = 500;
const QUOTE_DUPLICATE_REFRESH_INTERVAL_MS = 30_000;
const MIN_QUOTE_DUPLICATE_CHECK_LENGTH = 8;

function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function operationError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Quotabunga changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "This round was locked or changed. The latest state has been reloaded.";
    case "VALIDATION_FAILED":
      return "That Quotabunga entry is not valid. Check the form and try again.";
    default:
      return "Your Quotabunga entry could not be saved.";
  }
}

function sourceTypeLabel(sourceType: ConvexQuoteSourceType) {
  switch (sourceType) {
    case "TV":
      return "Television";
    case "MOVIE":
      return "Movie";
    default:
      return "Other";
  }
}

// Only the short summary is a live region, so screen readers are not read every
// excerpt again each time a check refreshes.
function DuplicateStatusPanel({
  children,
  details,
}: {
  children: ReactNode;
  details?: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-2">
        <p role="status">{children}</p>
        {details}
      </div>
    </div>
  );
}

function TranscriptMatchList({
  matches,
}: {
  matches: ConvexQuoteTranscriptMatch[];
}) {
  return (
    <ul className="space-y-2">
      {matches.map((match) => {
        const label = `Episode ${match.episodeNumber} · ${match.episodeTitle}`;
        return (
          <li
            key={`${match.episodeNumber}-${match.start}`}
            className="rounded border border-amber-400/20 bg-black/20 p-2"
          >
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold">
              {match.episodeSlug ? (
                // A new tab keeps the quote the listener is typing.
                <a
                  href={getEpisodePath(match.episodeSlug)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm underline hover:text-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  {label}
                </a>
              ) : (
                <span>{label}</span>
              )}
              <span className="font-mono font-normal text-amber-200/80">
                {formatTranscriptTime(match.start)}
              </span>
            </p>
            <p className="mt-1 break-words text-amber-50/80">
              &ldquo;{match.excerpt}&rdquo;
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function ConvexQuotabungaSubmission({
  isAdmin,
  episodeId,
  episodeStatus,
}: {
  isAdmin: boolean;
  /** The episode this panel belongs to; entries stay attached to it. */
  episodeId: string;
  episodeStatus: string;
}) {
  const convex = useConvex();
  const [current, setCurrent] = useState<ConvexCurrentQuoteSubmission | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceType, setSourceType] = useState<ConvexQuoteSourceType>("MOVIE");
  const [clipUrl, setClipUrl] = useState("");
  const [clipStartSeconds, setClipStartSeconds] = useState("");
  const [clipEndSeconds, setClipEndSeconds] = useState("");
  const [clipDuration, setClipDuration] = useState<number | null>(null);
  const youtube = parseYouTubeUrl(clipUrl);
  // The last complete YouTube video, so half-typed links don't reset times.
  const lastVideoIdRef = useRef<string | null>(null);
  // The last t= a link carried, so a "Share at" link can move the start.
  const lastLinkStartRef = useRef(0);
  const [listenerNotes, setListenerNotes] = useState("");
  const [duplicateCheck, setDuplicateCheck] = useState<{
    inputKey: string;
    status: "ready" | "unavailable";
    possibleMatch?: boolean;
    transcriptMatches?: ConvexQuoteTranscriptMatch[];
  } | null>(null);
  const loadGenerationRef = useRef(0);
  const { isAdminCollapsed, isContentVisible, headerProps } =
    useAdminCollapse(isAdmin);

  const submission = current?.submission ?? null;

  // Quotes lock on the same deadline as predictions, so watch the episode's
  // window live instead of trusting the open flag from the initial load.
  const liveWindow = useQuery(api.episodes.public.predictionWindow, {
    episodeId: documentId("episodes", episodeId),
  });
  const windowStatus =
    liveWindow === undefined ? episodeStatus : liveWindow?.status ?? null;
  const hasAired = windowStatus === "published";
  const closesAt =
    liveWindow === undefined ? null : liveWindow?.closesAt ?? null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const currentTime = Date.now();
    setNow(currentTime);
    if (
      windowStatus !== "recording" ||
      closesAt === null ||
      currentTime >= closesAt
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= closesAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [windowStatus, closesAt]);
  const isOpen =
    liveWindow === undefined
      ? current?.isOpen === true
      : getPredictionRoundState(windowStatus, true, closesAt, now) ===
        PredictionRoundState.OPEN;
  const closingCountdown =
    isOpen && windowStatus === "recording" && closesAt !== null
      ? formatCountdown(closesAt - now)
      : null;
  const currentRoundLink = hasAired ? (
    <Link
      href="/game"
      className="inline-flex items-center gap-1 text-sm font-semibold text-red-300 transition-colors hover:text-red-200"
    >
      Submit to the current round
    </Link>
  ) : null;
  const closingNotice =
    closingCountdown === null ? null : (
      <p
        className="text-center text-sm font-medium text-amber-400"
        role="status"
      >
        {`Entries lock with the picks in ${closingCountdown}.`}
      </p>
    );
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
    }
  }, [isOpen]);

  const duplicateInputKey = `${quoteText.trim()}\u0000${sourceTitle.trim()}`;
  const hasPossibleDuplicate =
    duplicateCheck?.inputKey === duplicateInputKey &&
    duplicateCheck.status === "ready" &&
    duplicateCheck.possibleMatch;
  const transcriptMatches =
    duplicateCheck?.inputKey === duplicateInputKey &&
    duplicateCheck.status === "ready"
      ? duplicateCheck.transcriptMatches ?? []
      : [];
  const isDuplicateCheckUnavailable =
    duplicateCheck?.inputKey === duplicateInputKey &&
    duplicateCheck.status === "unavailable";

  const resetForm = useCallback(() => {
    setQuoteText("");
    setSourceTitle("");
    setSourceType("MOVIE");
    setClipUrl("");
    setClipStartSeconds("");
    setClipEndSeconds("");
    setClipDuration(null);
    lastVideoIdRef.current = null;
    lastLinkStartRef.current = 0;
    setListenerNotes("");
  }, []);

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await loadConvexQuotabunga(convex, episodeId);
      if (loadGenerationRef.current === generation) {
        setCurrent(result);
      }
    } catch {
      if (loadGenerationRef.current === generation) {
        setErrorMessage(
          "Could not load your Quotabunga entry. Please try again."
        );
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [convex, episodeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (submission === null) {
      resetForm();
      setIsEditing(true);
      return;
    }
    setQuoteText(submission.quoteText);
    setSourceTitle(submission.sourceTitle);
    setSourceType(submission.sourceType);
    setClipUrl(submission.clipUrl ?? "");
    setClipStartSeconds(submission.clipStartSeconds?.toString() ?? "");
    setClipEndSeconds(submission.clipEndSeconds?.toString() ?? "");
    setClipDuration(null);
    const savedVideo = parseYouTubeUrl(submission.clipUrl ?? "");
    lastVideoIdRef.current = savedVideo?.id ?? null;
    lastLinkStartRef.current = savedVideo?.start ?? 0;
    setListenerNotes(submission.listenerNotes ?? "");
    setIsEditing(false);
  }, [resetForm, submission]);

  useEffect(() => {
    const normalizedQuote = quoteText.trim();
    const normalizedSource = sourceTitle.trim();
    if (
      !isEditing ||
      !isOpen ||
      normalizedQuote.length < MIN_QUOTE_DUPLICATE_CHECK_LENGTH
    ) {
      return;
    }
    const inputKey = `${normalizedQuote}\u0000${normalizedSource}`;
    let cancelled = false;
    let isCheckInFlight = false;
    const runDuplicateCheck = () => {
      if (isCheckInFlight) {
        return;
      }
      isCheckInFlight = true;
      void checkConvexQuotabungaDuplicate(convex, {
        episodeId,
        quoteText: normalizedQuote,
        sourceTitle: normalizedSource,
      })
        .then((result) => {
          if (!cancelled) {
            setDuplicateCheck({ inputKey, status: "ready", ...result });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDuplicateCheck({ inputKey, status: "unavailable" });
          }
        })
        .finally(() => {
          isCheckInFlight = false;
        });
    };
    const timeout = window.setTimeout(
      runDuplicateCheck,
      QUOTE_DUPLICATE_CHECK_DELAY_MS
    );
    const interval = window.setInterval(
      runDuplicateCheck,
      QUOTE_DUPLICATE_REFRESH_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [convex, episodeId, isOpen, isEditing, quoteText, sourceTitle]);

  // Switching to another YouTube video resets its times; typing, other hosts
  // and returning to the same video keep what the listener entered.
  const changeClipUrl = (nextUrl: string) => {
    const nextVideo = parseYouTubeUrl(nextUrl);
    if (nextVideo && nextVideo.id !== lastVideoIdRef.current) {
      // A new video, or a first link carrying its own t=, sets the moment;
      // a bare first link keeps a start typed beforehand.
      if (
        lastVideoIdRef.current !== null ||
        clipStartSeconds.trim() === "" ||
        nextVideo.start > 0
      ) {
        setClipStartSeconds(String(nextVideo.start));
        setClipEndSeconds("");
      }
      lastVideoIdRef.current = nextVideo.id;
      lastLinkStartRef.current = nextVideo.start;
    } else if (
      nextVideo &&
      nextVideo.start > 0 &&
      nextVideo.start !== lastLinkStartRef.current
    ) {
      // Same video, but the link now points at another moment.
      setClipStartSeconds(String(nextVideo.start));
      setClipEndSeconds("");
      lastLinkStartRef.current = nextVideo.start;
    }
    if (nextVideo?.id !== youtube?.id) setClipDuration(null);
    setClipUrl(nextUrl);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuote = quoteText.trim();
    const normalizedSource = sourceTitle.trim();
    const normalizedClipUrl = clipUrl.trim();
    const normalizedNotes = listenerNotes.trim();
    const parsedClipStart =
      clipStartSeconds.trim() === "" ? null : Number(clipStartSeconds);
    const parsedClipEnd =
      clipEndSeconds.trim() === "" ? null : Number(clipEndSeconds);

    if (
      normalizedQuote.length === 0 ||
      normalizedSource.length === 0 ||
      !validClipRange(parsedClipStart, parsedClipEnd) ||
      (parsedClipEnd !== null && !normalizedClipUrl) ||
      (youtube !== null &&
        clipDuration !== null &&
        ((parsedClipStart !== null && parsedClipStart >= clipDuration) ||
          (parsedClipEnd !== null && parsedClipEnd > clipDuration)))
    ) {
      setErrorMessage(
        `Add a quote and source. Clip times must be between 0 and ${String(
          MAX_CLIP_SECONDS
        )} seconds, with the end after the start, within the video, and a clip link.`
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await submitConvexQuotabunga(convex, episodeId, {
        quoteText: normalizedQuote,
        sourceTitle: normalizedSource,
        sourceType,
        // Hosts open this link while recording, so YouTube clips carry
        // the chosen start instead of opening at 0:00.
        clipUrl: youtube
          ? youtubeWatchUrl(youtube.id, parsedClipStart)
          : normalizedClipUrl || null,
        clipStartSeconds: parsedClipStart,
        // Backends before clip ranges reject this argument, so send it only
        // to set an end or clear a saved one.
        ...(parsedClipEnd === null && submission?.clipEndSeconds == null
          ? {}
          : { clipEndSeconds: parsedClipEnd }),
        listenerNotes: normalizedNotes || null,
      });
      await reload();
      setIsEditing(false);
      toast.success("Your Quotabunga entry is in!");
    } catch (error) {
      const message = operationError(error);
      setErrorMessage(message);
      toast.error(message);
      if (getConvexDomainErrorCode(error) === "CONFLICT") {
        await reload();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm("Withdraw this Quotabunga entry?")) {
      return;
    }
    setIsWithdrawing(true);
    setErrorMessage(null);
    try {
      await withdrawConvexQuotabunga(convex, episodeId);
      resetForm();
      await reload();
      setIsEditing(true);
      toast.success("Submission withdrawn");
    } catch (error) {
      const message = operationError(error);
      setErrorMessage(message);
      toast.error(message);
      if (getConvexDomainErrorCode(error) === "CONFLICT") {
        await reload();
      }
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <section id="quotabunga-submit" className="bbpc-panel p-4 sm:p-5">
      <AdminCollapsibleHeader
        isAdmin={isAdmin}
        isAdminCollapsed={isAdminCollapsed}
        className={cn(
          "gap-1",
          isContentVisible && "mb-5",
          !isAdmin && "text-center"
        )}
        titleWrapperClassName={cn(!isAdmin && "w-full text-center")}
        title={
          <h2 className="text-2xl font-black text-foreground">
            {isOpen ? "Submit to Quotabunga" : "Quotabunga"}
          </h2>
        }
        description={
          isContentVisible ? (
            <p className="mt-1 text-sm text-gray-400">
              One quote per listener, per episode.
            </p>
          ) : undefined
        }
        {...headerProps}
      />

      {isContentVisible ? (
        <>
          {errorMessage ? (
            <div
              className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
              role="alert"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{errorMessage}</span>
                {!isSaving && !isWithdrawing ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void reload()}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {isLoading && current === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin" aria-label="Loading entry" />
            </div>
          ) : current !== null && !isOpen && submission === null ? (
            <div className="space-y-3 text-center">
              <p className="text-gray-300">
                {hasAired
                  ? `Quotabunga entries for episode ${current.episode?.number} are closed.`
                  : `Submissions for episode ${current.episode?.number} are locked.`}
              </p>
              {currentRoundLink}
            </div>
          ) : submission !== null && !isEditing ? (
            <div className="space-y-4">
              {closingNotice}
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                <div className="mb-3 flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">
                    Submitted for episode {current?.episode?.number}
                  </span>
                </div>
                <blockquote className="whitespace-pre-wrap text-lg text-white">
                  &ldquo;{submission.quoteText}&rdquo;
                </blockquote>
                <p className="mt-2 text-sm text-gray-400">
                  {submission.sourceTitle} ·{" "}
                  {sourceTypeLabel(submission.sourceType)}
                </p>
                {submission.clipUrl ? (
                  <a
                    href={submission.clipUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary underline"
                  >
                    View submitted clip
                    {submission.clipStartSeconds !== null &&
                      ` · ${formatClipTime(submission.clipStartSeconds)}`}
                    {submission.clipEndSeconds != null &&
                      ` – ${formatClipTime(submission.clipEndSeconds)}`}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>

              {isOpen && !submission.scored ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditing(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={isWithdrawing}
                    onClick={() => void withdraw()}
                  >
                    {isWithdrawing ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Withdraw
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 text-center">
                  <p className="text-sm font-medium text-amber-400">
                    {submission.scored
                      ? "This entry has been scored and can no longer be changed."
                      : hasAired
                      ? "This episode has aired, so this entry is final."
                      : "This round is locked for recording."}
                  </p>
                  {currentRoundLink}
                </div>
              )}
            </div>
          ) : current !== null ? (
            <form
              className="space-y-4"
              onSubmit={(event) => void handleSubmit(event)}
            >
              {closingNotice}
              <div className="space-y-2">
                <label
                  htmlFor="convex-quotabunga-quote"
                  className="text-sm font-semibold"
                >
                  Quote or scene
                </label>
                <Textarea
                  id="convex-quotabunga-quote"
                  required
                  maxLength={MAX_QUOTE_TEXT_LENGTH}
                  value={quoteText}
                  onChange={(event) => setQuoteText(event.target.value)}
                  placeholder="Type the exact quote or describe the quote-worthy scene..."
                  className="min-h-28"
                />
                <p className="text-right text-xs text-gray-500">
                  {quoteText.length}/{MAX_QUOTE_TEXT_LENGTH}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <label
                    htmlFor="convex-quotabunga-source"
                    className="text-sm font-semibold"
                  >
                    Movie or show
                  </label>
                  <Input
                    id="convex-quotabunga-source"
                    required
                    maxLength={500}
                    value={sourceTitle}
                    onChange={(event) => setSourceTitle(event.target.value)}
                    placeholder="Heat"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="convex-quotabunga-source-type"
                    className="text-sm font-semibold"
                  >
                    Source type
                  </label>
                  <select
                    id="convex-quotabunga-source-type"
                    value={sourceType}
                    onChange={(event) =>
                      setSourceType(event.target.value as ConvexQuoteSourceType)
                    }
                    className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="MOVIE">Movie</option>
                    <option value="TV">Television</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              {hasPossibleDuplicate ? (
                <DuplicateStatusPanel>
                  <span className="font-semibold">Possible duplicate.</span> A
                  similar quote may have been submitted before. You can still
                  submit it, but duplicate entries may be judged less favorably.
                </DuplicateStatusPanel>
              ) : null}

              {transcriptMatches.length > 0 ? (
                <DuplicateStatusPanel
                  details={<TranscriptMatchList matches={transcriptMatches} />}
                >
                  <span className="font-semibold">
                    Possibly heard on the show.
                  </span>{" "}
                  Something close to this quote comes up in{" "}
                  {transcriptMatches.length === 1
                    ? "an episode transcript"
                    : "episode transcripts"}
                  . You can still submit it, but repeats may be judged less
                  favorably.
                </DuplicateStatusPanel>
              ) : null}

              {isDuplicateCheckUnavailable ? (
                <DuplicateStatusPanel>
                  <span className="font-semibold">
                    Couldn&apos;t check for duplicates.
                  </span>{" "}
                  You can still submit, but it may be judged less favorably if a
                  similar quote was already entered.
                </DuplicateStatusPanel>
              ) : null}

              <QuotabungaClipFields
                clipUrl={clipUrl}
                start={clipStartSeconds}
                end={clipEndSeconds}
                suggestedQuery={[sourceTitle, quoteText].filter(Boolean).join(" ")}
                onClipUrlChange={changeClipUrl}
                onStartChange={setClipStartSeconds}
                onEndChange={setClipEndSeconds}
                onQuoteChange={setQuoteText}
                onDurationChange={setClipDuration}
              />

              <div className="space-y-2">
                <label
                  htmlFor="convex-quotabunga-notes"
                  className="text-sm font-semibold"
                >
                  Notes for the hosts{" "}
                  <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <Textarea
                  id="convex-quotabunga-notes"
                  maxLength={1000}
                  value={listenerNotes}
                  onChange={(event) => setListenerNotes(event.target.value)}
                  placeholder="Context, preferred stopping point, or why this quote rules..."
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {submission ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  disabled={
                    isSaving ||
                    quoteText.trim().length === 0 ||
                    sourceTitle.trim().length === 0
                  }
                >
                  {isSaving ? <Loader2 className="animate-spin" /> : null}
                  {submission ? "Save changes" : "Submit quote"}
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
