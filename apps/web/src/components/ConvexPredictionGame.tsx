"use client";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";

import { api } from "@tonyisup/bbpc-convex-api";

import { useConvex, useQuery } from "convex/react";
import type { ConvexReactClient } from "convex/react";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Info,
  Loader2,
  Mic,
  Play,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

import RatingIcon from "@/components/RatingIcon";
import { ConvexAssignmentGamblingBoard } from "@/components/ConvexAssignmentGamblingBoard";
import { VoiceVisualizer } from "@/components/common/VoiceVisualizer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type ConvexPredictionData,
  type ConvexPredictionGuess,
  type ConvexPredictionHost,
  type ConvexPredictionRating,
  loadConvexPredictionData,
  submitConvexPrediction,
} from "@/convex/predictions";
import {
  BBPC_CLIENT_API_VERSION,
  getConvexDomainErrorCode,
} from "@/convex/identity";
import {
  PredictionRoundState,
  getPredictionRoundState,
} from "@/lib/predictionRound.mjs";
import { cn } from "@/lib/utils";
import { highlightText } from "@/utils/text";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useUploadThing } from "@/utils/uploadthing";
import type { PredictionGameAssignment } from "@/types/prediction";

const assignmentAudioMessageSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  createdAt: z.number().finite(),
  fileKey: z.string().nullable(),
});
const assignmentAudioMessagesSchema = z.array(assignmentAudioMessageSchema);
type AssignmentAudioMessage = z.infer<typeof assignmentAudioMessageSchema>;

const listMyAudioMessagesReference = api.assignments.public.listMyAudioMessages;
const createMyAudioMessageReference =
  api.assignments.public.createMyAudioMessage;
const deleteMyAudioMessageReference =
  api.assignments.public.deleteMyAudioMessage;
const discardMyAudioUploadReference =
  api.assignments.public.discardMyAudioUpload;

async function loadMyAssignmentAudioMessages(
  convex: ConvexReactClient,
  assignmentId: string
) {
  return assignmentAudioMessagesSchema.parse(
    await convex.query(listMyAudioMessagesReference, {
      assignmentId: documentId("assignments", assignmentId),
    })
  );
}

function saveError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Prediction changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "Picks closed before this change could be saved.";
    case "VALIDATION_FAILED":
      return "That prediction is no longer valid for this round.";
    default:
      return "Couldn’t save this pick. Check your connection and retry.";
  }
}

function findGuessForHost(guesses: ConvexPredictionGuess[], hostId: string) {
  return guesses.find((guess) => guess.hostId === hostId);
}

function ConvexAssignmentVoiceMessages({
  assignmentId,
  isVisible,
}: {
  assignmentId: string;
  isVisible: boolean;
}) {
  const convex = useConvex();
  const [messages, setMessages] = useState<AssignmentAudioMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {
    isRecording,
    recordingTime,
    audioBlob,
    isPlaying,
    permissionDenied,
    volume,
    startRecording,
    stopRecording,
    playRecording,
    stopPlayback,
    resetRecording,
  } = useAudioRecorder();
  const { startUpload, isUploading } = useUploadThing("audioUploader");

  useEffect(() => {
    if (!isVisible) {
      if (isRecording) stopRecording();
      if (isPlaying) stopPlayback();
    }
  }, [isVisible, isRecording, isPlaying, stopRecording, stopPlayback]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setMessages(await loadMyAssignmentAudioMessages(convex, assignmentId));
      setErrorMessage(null);
    } catch {
      setErrorMessage("Couldn’t load your voice messages.");
    } finally {
      setIsLoading(false);
    }
  }, [assignmentId, convex]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submit = async () => {
    if (audioBlob === null) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    let uploadedFile: { key: string; url: string } | undefined;
    const uploadId = crypto.randomUUID();
    try {
      const extension = audioBlob.type.split("/")[1]?.split(";")[0] ?? "webm";
      const file = new File(
        [audioBlob],
        `assignment-${assignmentId}-voice-${Date.now()}.${extension}`,
        { type: audioBlob.type }
      );
      uploadedFile = (await startUpload([file], { assignmentId }))?.[0];
      if (
        uploadedFile === undefined ||
        uploadedFile.key.length === 0 ||
        uploadedFile.url.length === 0
      ) {
        throw new Error("assignment-audio-upload-failed");
      }
      assignmentAudioMessageSchema.parse(
        await convex.mutation(createMyAudioMessageReference, {
          clientApiVersion: BBPC_CLIENT_API_VERSION,
          assignmentId: documentId("assignments", assignmentId),
          url: uploadedFile.url,
          fileKey: uploadedFile.key,
          createdAt: Date.now(),
        })
      );
      resetRecording();
      await reload();
      toast.success("Voice message submitted");
    } catch {
      if (uploadedFile !== undefined) {
        try {
          const adopted = await loadMyAssignmentAudioMessages(
            convex,
            assignmentId
          );
          if (
            adopted.some((message) => message.fileKey === uploadedFile?.key)
          ) {
            setMessages(adopted);
            resetRecording();
            toast.success("Voice message submitted");
            return;
          }
        } catch {
          // If recovery cannot confirm adoption, queue provider cleanup below.
        }
        try {
          await convex.mutation(discardMyAudioUploadReference, {
            clientApiVersion: BBPC_CLIENT_API_VERSION,
            assignmentId: documentId("assignments", assignmentId),
            fileKey: uploadedFile.key,
            uploadId,
          });
        } catch {
          setErrorMessage(
            "The recording wasn’t saved and its cleanup needs administrator review."
          );
          setIsSubmitting(false);
          return;
        }
      }
      setErrorMessage("Couldn’t submit the voice message. Please retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this recording?")) return;
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await convex.mutation(deleteMyAudioMessageReference, {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id: documentId("assignmentAudioMessages", id),
      });
      setMessages((current) => current.filter((message) => message.id !== id));
      toast.success("Recording deleted");
    } catch {
      setErrorMessage("Couldn’t delete the recording. Please retry.");
    } finally {
      setDeletingId(null);
    }
  };

  const formatTime = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
      seconds % 60
    ).padStart(2, "0")}`;
  const busy = isSubmitting || isUploading;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-white">Assignment voice message</p>
        <span className="text-xs text-zinc-400">
          {isLoading ? "Loading…" : `${messages.length} saved`}
        </span>
      </div>

      {messages.length > 0 ? (
        <div className="space-y-2">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className="flex items-center gap-2 rounded-md bg-white/[0.04] p-2"
            >
              <audio
                className="h-9 min-w-0 flex-1"
                controls
                preload="none"
                src={message.url}
                aria-label={`Saved recording ${index + 1}`}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Delete saved recording ${index + 1}`}
                disabled={deletingId !== null}
                onClick={() => void remove(message.id)}
              >
                {deletingId === message.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {permissionDenied ? (
        <Alert variant="destructive">
          <AlertDescription>
            Microphone access was denied. Allow microphone access and retry.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-24 items-center justify-center rounded-md bg-white/[0.04] p-3 text-center">
        {isRecording ? (
          <div className="flex flex-col items-center">
            <VoiceVisualizer
              volume={volume}
              isRecording={isRecording}
              className="mb-2"
            />
            <span className="font-bold text-white">
              Recording {formatTime(recordingTime)}
            </span>
          </div>
        ) : audioBlob !== null ? (
          <span className="text-sm text-zinc-300">
            Ready to send · {formatTime(recordingTime)}
          </span>
        ) : (
          <span className="text-sm text-zinc-400">
            Record a short message for the episode.
          </span>
        )}
      </div>

      {isRecording ? (
        <Button
          type="button"
          variant="destructive"
          className="w-full"
          onClick={stopRecording}
        >
          <Square className="mr-2 h-4 w-4" /> Stop recording
        </Button>
      ) : audioBlob !== null ? (
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label="Discard recording"
            disabled={busy}
            onClick={resetRecording}
          >
            <X className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label={isPlaying ? "Stop preview" : "Preview recording"}
            onClick={isPlaying ? stopPlayback : playRecording}
          >
            {isPlaying ? (
              <Square className="h-4 w-4 sm:mr-2" />
            ) : (
              <Play className="h-4 w-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">
              {isPlaying ? "Stop" : "Preview"}
            </span>
          </Button>
          <Button
            type="button"
            aria-label="Send voice message"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
            ) : (
              <Send className="h-4 w-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
      ) : (
        <Button type="button" className="w-full" onClick={startRecording}>
          <Mic className="mr-2 h-4 w-4" /> Record voice message
        </Button>
      )}

      {errorMessage !== null ? (
        <p className="text-sm text-red-200" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function ConvexPredictionGame({
  episodeId,
  assignments,
  episodeStatus: initialEpisodeStatus,
  searchQuery = "",
}: {
  episodeId: string;
  assignments: PredictionGameAssignment[];
  episodeStatus: string;
  searchQuery?: string;
}) {
  const convex = useConvex();
  const liveWindow = useQuery(api.episodes.public.predictionWindow, {
    episodeId: documentId("episodes", episodeId),
  });
  const episodeStatus =
    liveWindow === undefined ? initialEpisodeStatus : liveWindow?.status ?? "";
  const closesAt = liveWindow?.closesAt ?? null;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const currentTime = Date.now();
    setNow(currentTime);
    if (
      episodeStatus !== "recording" ||
      closesAt === null ||
      currentTime >= closesAt
    )
      return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime >= closesAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [episodeStatus, closesAt]);
  const [data, setData] = useState<ConvexPredictionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingHosts, setSavingHosts] = useState<Record<string, string | null>>(
    {}
  );
  const [openRequest, setOpenRequest] = useState({
    assignmentId: "",
    sequence: 0,
  });
  const openAssignment = (assignmentId: string) => {
    setOpenRequest((current) => ({
      assignmentId,
      sequence: current.sequence + 1,
    }));
  };
  const loadGenerationRef = useRef(0);
  const assignmentIds = useMemo(
    () => assignments.map((assignment) => assignment.id),
    [assignments]
  );

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await loadConvexPredictionData(convex, assignmentIds);
      if (loadGenerationRef.current === generation) {
        setData(result);
      }
    } catch {
      if (loadGenerationRef.current === generation) {
        setLoadError(
          "Couldn’t load the game. Check your connection and retry."
        );
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [assignmentIds, convex]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading && data === null) {
    return (
      <div
        className="h-64 animate-pulse rounded-xl bg-white/[0.04]"
        aria-label="Loading saved picks"
        role="status"
      />
    );
  }

  if (loadError !== null && data === null) {
    return (
      <div
        className="rounded-xl border border-red-500/30 bg-red-500/[0.08] p-5"
        role="alert"
      >
        <p className="font-bold text-white">Couldn&apos;t load the game.</p>
        <p className="mt-1 text-sm text-zinc-300">{loadError}</p>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => void reload()}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (data === null) {
    return null;
  }

  if (!data.activeSeason) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <p className="font-bold text-white">No active game season</p>
        <p className="mt-1 text-sm text-zinc-400">
          Picks will return when the next season begins.
        </p>
      </div>
    );
  }

  if (data.hosts.length === 0 || data.ratings.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <p className="font-bold text-white">Picks aren&apos;t available yet</p>
        <p className="mt-1 text-sm text-zinc-400">
          The hosts and rating scale still need to be set up for this round.
        </p>
      </div>
    );
  }

  const totalPickCount = assignments.length * data.hosts.length;
  const savedPickCount = assignments.reduce(
    (total, assignment) =>
      total +
      data.hosts.filter(
        (host) =>
          host.id !== savingHosts[assignment.id] &&
          findGuessForHost(
            data.guessesByAssignment[assignment.id] ?? [],
            host.id
          )
      ).length,
    0
  );
  const isRoundOpen =
    getPredictionRoundState(episodeStatus, true, closesAt, now) ===
    PredictionRoundState.OPEN;
  const remainingSeconds =
    closesAt === null ? 0 : Math.max(0, Math.ceil((closesAt - now) / 1000));
  const assignmentProgress = assignments.map((assignment) => {
    const saved = data.hosts.filter(
      (host) =>
        host.id !== savingHosts[assignment.id] &&
        findGuessForHost(data.guessesByAssignment[assignment.id] ?? [], host.id)
    ).length;
    return { assignment, saved, complete: saved === data.hosts.length };
  });
  const completedMovies = assignmentProgress.filter(
    (item) => item.complete
  ).length;

  return (
    <section className="space-y-4" aria-label="Rating predictions">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide",
                isRoundOpen && episodeStatus !== "recording"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-200"
              )}
            >
              {isRoundOpen
                ? episodeStatus === "recording"
                  ? "Closing soon"
                  : "Round open"
                : "Picks locked"}
            </span>
            <p className="text-sm font-semibold text-white" aria-live="polite">
              {savedPickCount} of {totalPickCount} picks saved
            </p>
          </div>
          {savedPickCount === totalPickCount && totalPickCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-300">
              <Check className="h-4 w-4" aria-hidden="true" />
              All picks complete
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">
          Choose the rating you think each host will give. Changes save
          automatically. Picks and wagers stay editable until 10 minutes after
          recording starts.
        </p>
        {episodeStatus === "recording" && isRoundOpen ? (
          <p className="mt-2 font-semibold tabular-nums text-amber-200">
            Picks and wagers close in {Math.floor(remainingSeconds / 60)}:
            {String(remainingSeconds % 60).padStart(2, "0")}.
          </p>
        ) : null}
        {assignments.length > 1 ? (
          <nav className="mt-4 space-y-2" aria-label="Movie pick checklist">
            <p className="text-sm font-semibold text-white" aria-live="polite">
              {completedMovies} of {assignments.length} movies complete.{" "}
              {isRoundOpen
                ? "Pick ratings for every movie."
                : "Review your saved picks."}
            </p>
            <ol className="grid gap-2 sm:grid-cols-2">
              {assignmentProgress.map(
                ({ assignment, saved, complete }, index) => (
                  <li key={assignment.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => openAssignment(assignment.id)}
                    >
                      <span className="min-w-0 break-words font-semibold">
                        {index + 1}.{" "}
                        {assignment.movie?.title ?? "Unknown movie"}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          complete ? "text-emerald-300" : "text-amber-200"
                        )}
                      >
                        {complete
                          ? "Complete"
                          : `${saved}/${data.hosts.length} saved`}
                      </span>
                    </button>
                  </li>
                )
              )}
            </ol>
          </nav>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/10 pt-4">
          {data.ratings.map((rating) => (
            <div
              key={rating.id}
              className="inline-flex items-center gap-2 text-sm text-zinc-300"
            >
              <RatingIcon value={rating.value} />
              <span className="font-semibold text-white">{rating.name}</span>
              {rating.category ? (
                <span className="text-zinc-500">{rating.category}</span>
              ) : null}
            </div>
          ))}
        </div>
        <details className="mt-4 border-t border-white/10 pt-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 [&::-webkit-details-marker]:hidden">
            <Info className="h-4 w-4" aria-hidden="true" />
            How picks score
          </summary>
          <dl className="grid gap-2 pb-2 pt-1 sm:grid-cols-3">
            <ScoringItem
              label="Correct host"
              points={data.scoring.correctHost}
            />
            <ScoringItem
              label="All hosts correct"
              points={data.scoring.allCorrectBonus}
            />
            <ScoringItem
              label="All hosts wrong"
              points={data.scoring.allIncorrect}
            />
          </dl>
        </details>
      </div>

      {loadError !== null ? (
        <div
          className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3 text-sm text-red-100"
          role="alert"
        >
          {loadError} Your currently displayed choices have not been changed.
        </div>
      ) : null}

      {assignments.map((assignment) => (
        <ConvexAssignmentPrediction
          key={assignment.id}
          assignment={assignment}
          hosts={data.hosts}
          ratings={data.ratings}
          guesses={data.guessesByAssignment[assignment.id] ?? []}
          episodeStatus={episodeStatus}
          closesAt={closesAt}
          now={now}
          searchQuery={searchQuery}
          initiallyExpanded={false}
          openRequest={
            openRequest.assignmentId === assignment.id
              ? openRequest.sequence
              : 0
          }
          nextIncompleteAssignment={
            assignmentProgress.find(
              (item) => !item.complete && item.assignment.id !== assignment.id
            )?.assignment
          }
          onContinue={openAssignment}
          onSavingChange={(hostId) => {
            setSavingHosts((current) => ({
              ...current,
              [assignment.id]: hostId,
            }));
          }}
          onGuessSaved={(guess) => {
            setData((current) => {
              if (current === null) {
                return current;
              }
              const existing = current.guessesByAssignment[assignment.id] ?? [];
              return {
                ...current,
                guessesByAssignment: {
                  ...current.guessesByAssignment,
                  [assignment.id]: [
                    ...existing.filter(
                      (candidate) => candidate.hostId !== guess.hostId
                    ),
                    guess,
                  ],
                },
              };
            });
          }}
        />
      ))}
    </section>
  );
}

function ScoringItem({
  label,
  points,
}: {
  label: string;
  points: number | null;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 rounded-lg bg-white/[0.04] px-3 py-2">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="font-black tabular-nums text-white">
        {points === null ? "Unavailable" : `${points > 0 ? "+" : ""}${points}`}
      </dd>
    </div>
  );
}

interface ConvexAssignmentPredictionProps {
  assignment: PredictionGameAssignment;
  hosts: ConvexPredictionHost[];
  ratings: ConvexPredictionRating[];
  guesses: ConvexPredictionGuess[];
  episodeStatus: string;
  closesAt: number | null;
  now: number;
  searchQuery: string;
  initiallyExpanded: boolean;
  onGuessSaved: (guess: ConvexPredictionGuess) => void;
  onSavingChange: (hostId: string | null) => void;
  openRequest: number;
  nextIncompleteAssignment?: PredictionGameAssignment;
  onContinue: (assignmentId: string) => void;
}

const ConvexAssignmentPrediction: FC<ConvexAssignmentPredictionProps> = ({
  assignment,
  hosts,
  ratings,
  guesses,
  episodeStatus,
  closesAt,
  now,
  searchQuery,
  initiallyExpanded,
  onGuessSaved,
  onSavingChange,
  openRequest,
  nextIncompleteAssignment,
  onContinue,
}) => {
  const convex = useConvex();
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const [hasExpanded, setHasExpanded] = useState(initiallyExpanded);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (openRequest === 0) return;
    setHasExpanded(true);
    setIsExpanded(true);
    headingRef.current?.scrollIntoView({ block: "start" });
    headingRef.current?.focus({ preventScroll: true });
  }, [openRequest]);
  const [optimisticGuess, setOptimisticGuess] =
    useState<ConvexPredictionGuess | null>(null);
  const [savingHostId, setSavingHostId] = useState<string | null>(null);
  const [lastSavedHostId, setLastSavedHostId] = useState<string | null>(null);
  const [failedPick, setFailedPick] = useState<{
    hostId: string;
    ratingId: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedCount = hosts.filter((host) =>
    findGuessForHost(guesses, host.id)
  ).length;
  const hasAllGuesses = hosts.length > 0 && selectedCount === hosts.length;
  const allPicksSaved = hasAllGuesses && savingHostId === null;
  const isRoundOpen =
    getPredictionRoundState(
      episodeStatus,
      assignment.playable,
      closesAt,
      now
    ) === PredictionRoundState.OPEN;

  const chooseRating = async (hostId: string, ratingId: string) => {
    if (!isRoundOpen || savingHostId !== null) {
      return;
    }
    const rating = ratings.find((candidate) => candidate.id === ratingId);
    if (rating === undefined) {
      return;
    }
    const previousGuess = findGuessForHost(guesses, hostId);
    const optimisticGuess: ConvexPredictionGuess = {
      id: previousGuess?.id ?? `pending:${assignment.id}:${hostId}`,
      hostId,
      rating,
    };
    setSavingHostId(hostId);
    onSavingChange(hostId);
    setLastSavedHostId(null);
    setFailedPick(null);
    setErrorMessage(null);
    setOptimisticGuess(optimisticGuess);
    try {
      const saved = await submitConvexPrediction(convex, {
        assignmentId: assignment.id,
        hostId,
        ratingId,
      });
      onGuessSaved(saved);
      setLastSavedHostId(hostId);
    } catch (error) {
      setFailedPick({ hostId, ratingId });
      setErrorMessage(saveError(error));
    } finally {
      setSavingHostId(null);
      setOptimisticGuess(null);
      onSavingChange(null);
    }
  };

  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          {assignment.movie?.poster ? (
            <Image
              src={assignment.movie.poster}
              alt=""
              width={40}
              height={60}
              sizes="40px"
              className="h-[60px] w-10 shrink-0 rounded-md border border-white/10 object-cover shadow-sm"
            />
          ) : (
            <div
              className="flex h-[60px] w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-500"
              aria-hidden="true"
            >
              <Film className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="scroll-mt-24 text-xl font-black text-white"
              >
                {assignment.movie
                  ? highlightText(assignment.movie.title, searchQuery)
                  : "Unknown movie"}
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-bold",
                  allPicksSaved
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-amber-400/10 text-amber-200"
                )}
              >
                {savingHostId !== null
                  ? "Saving…"
                  : allPicksSaved
                  ? "Complete"
                  : selectedCount === 0
                  ? "Needs picks"
                  : `${selectedCount} of ${hosts.length} saved`}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-400">
              {isRoundOpen
                ? savingHostId !== null
                  ? "Saving your choice. Wait for confirmation before leaving."
                  : allPicksSaved
                  ? "Your choices are saved. You can edit them while the round is open."
                  : `Choose ${hosts.length - selectedCount} more ${
                      hosts.length - selectedCount === 1 ? "rating" : "ratings"
                    }.`
                : "This round is closed. Your saved choices are shown below."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={isExpanded ? "ghost" : "outline"}
          className="min-h-11 shrink-0 justify-between sm:justify-center"
          aria-expanded={isExpanded}
          onClick={() => {
            setHasExpanded(true);
            setIsExpanded((value) => !value);
          }}
        >
          {isExpanded
            ? "Hide picks"
            : selectedCount > 0
            ? "View or edit picks"
            : "Make picks"}
          {isExpanded ? (
            <ChevronUp aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </Button>
      </div>

      {!isExpanded && selectedCount > 0 ? (
        <ul className="grid gap-x-6 gap-y-2 border-t border-white/10 px-4 py-3 sm:px-5 md:grid-cols-3">
          {hosts.map((host) => {
            const guess = findGuessForHost(guesses, host.id);
            return guess ? (
              <li
                key={host.id}
                className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm text-zinc-300"
              >
                <span className="font-semibold text-white">
                  {host.name ?? "Host"}
                </span>
                <span aria-hidden="true">—</span>
                <RatingIcon value={guess.rating.value} />
                <span>{guess.rating.name}</span>
              </li>
            ) : null;
          })}
        </ul>
      ) : null}

      {hasExpanded ? (
        <div
          hidden={!isExpanded}
          className="space-y-4 border-t border-white/10 p-4 sm:p-5"
        >
          {hosts.map((host) => {
            const guess =
              optimisticGuess?.hostId === host.id
                ? optimisticGuess
                : findGuessForHost(guesses, host.id);
            const isSaving = savingHostId === host.id;
            const didFail = failedPick?.hostId === host.id;
            const isSaved = !isSaving && !didFail && Boolean(guess?.rating.id);
            return (
              <fieldset
                key={host.id}
                className="rounded-lg border border-white/10 bg-black/20 p-3 sm:p-4"
                disabled={!isRoundOpen || savingHostId !== null}
              >
                <legend className="px-1 font-bold text-white">
                  {host.name ?? "Host"}
                </legend>
                <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      isSaving
                        ? "text-amber-200"
                        : didFail
                        ? "text-red-300"
                        : isSaved
                        ? "text-emerald-300"
                        : "text-zinc-500"
                    )}
                    aria-live="polite"
                  >
                    {isSaving
                      ? "Saving…"
                      : didFail
                      ? "Couldn’t save"
                      : isSaved
                      ? lastSavedHostId === host.id
                        ? "Saved just now"
                        : "Saved"
                      : "Not picked"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ratings.map((rating) => {
                    const isSelected = guess?.rating.id === rating.id;
                    return (
                      <label key={rating.id} className="cursor-pointer">
                        <input
                          type="radio"
                          name={`convex-prediction-${assignment.id}-${host.id}`}
                          value={rating.id}
                          checked={isSelected}
                          onChange={() => void chooseRating(host.id, rating.id)}
                          disabled={!isRoundOpen || savingHostId !== null}
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-red-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black",
                            isSelected
                              ? "border-red-400 bg-red-500/15 text-white"
                              : "border-white/15 bg-white/[0.035] text-zinc-300 hover:border-white/30 hover:bg-white/[0.07]",
                            (!isRoundOpen || savingHostId !== null) &&
                              "cursor-not-allowed opacity-60"
                          )}
                        >
                          <RatingIcon value={rating.value} />
                          <span>{rating.name}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          {errorMessage !== null && failedPick !== null ? (
            <div
              className="flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <p className="text-sm text-red-100">{errorMessage}</p>
              {isRoundOpen ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void chooseRating(failedPick.hostId, failedPick.ratingId)
                  }
                  disabled={savingHostId !== null}
                >
                  Retry save
                </Button>
              ) : null}
            </div>
          ) : null}

          {allPicksSaved && nextIncompleteAssignment && isRoundOpen ? (
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p className="text-sm text-foreground">
                This movie is complete. There are still picks to make for
                another movie.
              </p>
              <Button
                className="mt-2 h-auto min-h-11 whitespace-normal text-left"
                onClick={() => onContinue(nextIncompleteAssignment.id)}
              >
                Continue to{" "}
                {nextIncompleteAssignment.movie?.title ?? "the next movie"}
              </Button>
            </div>
          ) : null}

          {hasAllGuesses ? (
            <details className="rounded-lg border border-white/10 bg-black/20">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  Wager points <span className="text-zinc-500">— optional</span>
                </span>
                <ChevronDown
                  className="h-4 w-4 text-zinc-400"
                  aria-hidden="true"
                />
              </summary>
              <div className="border-t border-white/10 p-3 sm:p-4">
                {savingHostId !== null ? (
                  <p role="status" className="mb-3 text-sm text-amber-200">
                    Wagering will be available after your pick finishes saving.
                  </p>
                ) : null}
                <fieldset
                  disabled={savingHostId !== null}
                  aria-label="Wager options"
                >
                  <ConvexAssignmentGamblingBoard
                    assignmentId={assignment.id}
                    hosts={hosts}
                    guesses={guesses}
                    episodeStatus={episodeStatus}
                    closesAt={closesAt}
                    now={now}
                    playable={assignment.playable}
                  />
                </fieldset>
              </div>
            </details>
          ) : null}

          <ConvexAssignmentVoiceMessages
            assignmentId={assignment.id}
            isVisible={isExpanded}
          />
        </div>
      ) : null}
    </article>
  );
};
