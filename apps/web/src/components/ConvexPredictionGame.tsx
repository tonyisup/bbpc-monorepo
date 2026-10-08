"use client";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";

import { api } from "@tonyisup/bbpc-convex-api";

import { useConvex, useQuery } from "convex/react";
import type { ConvexReactClient } from "convex/react";

import {
  Check,
  Film,
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
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

import RatingIcon from "@/components/RatingIcon";
import { ConvexAssignmentGamblingBoard } from "@/components/ConvexAssignmentGamblingBoard";
import {
  GameSheet,
  GameSheetHeader,
  GameSheetRow,
} from "@/components/GameSheet";
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
  title,
}: {
  assignmentId: string;
  isVisible: boolean;
  title: string;
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
    <div className="space-y-3 rounded-lg border border-white/10 bg-[color:var(--bbpc-surface-raised)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-white">{title}</p>
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

      {isRecording ? (
        <div className="flex flex-col items-center rounded-md bg-white/[0.04] p-3 text-center">
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
        <p className="rounded-md bg-white/[0.04] p-3 text-center text-sm text-zinc-300">
          Ready to send · {formatTime(recordingTime)}
        </p>
      ) : null}

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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={startRecording}
          >
            <Mic className="mr-2 h-4 w-4" />
            {messages.length > 0 ? "Record another" : "Record voice message"}
          </Button>
          <span className="text-sm text-zinc-400">
            Record a short message for the episode.
          </span>
        </div>
      )}

      {errorMessage !== null ? (
        <p className="text-sm text-red-200" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

// One column for the host, then one per rating. The rating count comes from
// the season's scale, so it is passed as a custom property.
const scorecardGrid =
  "grid grid-cols-[3.75rem_repeat(var(--ratings),minmax(0,1fr))] items-center gap-1.5 px-4 sm:grid-cols-[minmax(8.75rem,1.15fr)_repeat(var(--ratings),minmax(0,1fr))] sm:px-6";

const pickedTone: Record<number, string> = {
  1: "border-red-500/55 bg-red-500/15",
  2: "border-orange-500/55 bg-orange-500/15",
  3: "border-yellow-500/55 bg-yellow-500/15",
  4: "border-green-500/55 bg-green-500/15",
};

// RatingIcon only draws the four standard ratings; any other value is shown
// by name instead, on two lines where a phone cell is narrow.
const namedCell =
  "line-clamp-2 px-1 text-center text-[0.6875rem] leading-tight sm:text-sm";

function hasRatingIcon(value: number) {
  return value >= 1 && value <= 4;
}

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A rating's icon and name, as shown in a cell the listener has picked. */
function PickedRating({ rating }: { rating: ConvexPredictionRating }) {
  const hasIcon = hasRatingIcon(rating.value);
  return (
    <>
      {hasIcon ? <RatingIcon value={rating.value} /> : null}
      <span className="sr-only">{rating.name}</span>
      <span
        aria-hidden="true"
        className={hasIcon ? "hidden sm:inline" : namedCell}
      >
        {rating.name}
      </span>
    </>
  );
}

export function ConvexPredictionGame({
  episodeId,
  assignments,
  episodeStatus: initialEpisodeStatus,
  searchQuery = "",
  children,
}: {
  episodeId: string;
  assignments: PredictionGameAssignment[];
  episodeStatus: string;
  searchQuery?: string;
  /** Further rows of the same sheet, shown after the movies. */
  children?: ReactNode;
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

  // Every state keeps the same three slots, so the rows passed as children
  // stay mounted while the picks load.
  const sheet = (
    content: ReactNode,
    status: ReactNode = null,
    footer: ReactNode = null
  ) => (
    <GameSheet aria-label="Listener game">
      <GameSheetHeader title="Guess the hosts’ ratings">
        {status}
      </GameSheetHeader>
      {content}
      {children}
      {footer}
    </GameSheet>
  );

  if (isLoading && data === null) {
    return sheet(
      <GameSheetRow aria-label="Loading saved picks" role="status">
        <div className="h-3 w-48 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-4 space-y-1.5">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-11 animate-pulse rounded-lg bg-white/[0.04]"
            />
          ))}
        </div>
      </GameSheetRow>
    );
  }

  if (loadError !== null && data === null) {
    return sheet(
      <GameSheetRow
        className="flex flex-wrap items-center justify-between gap-3"
        role="alert"
      >
        <div>
          <p className="font-bold text-white">Couldn&apos;t load the game.</p>
          <p className="mt-0.5 text-zinc-300">{loadError}</p>
        </div>
        <Button variant="outline" onClick={() => void reload()}>
          Try again
        </Button>
      </GameSheetRow>
    );
  }

  if (data === null) {
    return sheet(null);
  }

  if (!data.activeSeason) {
    return sheet(
      <GameSheetRow>
        <p className="font-bold text-white">No active game season</p>
        <p className="mt-0.5 text-zinc-400">
          Picks will return when the next season begins.
        </p>
      </GameSheetRow>
    );
  }

  if (data.hosts.length === 0 || data.ratings.length === 0) {
    return sheet(
      <GameSheetRow>
        <p className="font-bold text-white">Picks aren&apos;t available yet</p>
        <p className="mt-0.5 text-zinc-400">
          The hosts and rating scale still need to be set up for this round.
        </p>
      </GameSheetRow>
    );
  }

  const playableAssignments = assignments.filter(
    (assignment) => assignment.playable
  );
  const totalPickCount = playableAssignments.length * data.hosts.length;
  const savedPickCount = playableAssignments.reduce(
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
  const roundState = getPredictionRoundState(
    episodeStatus,
    true,
    closesAt,
    now
  );
  const isRoundOpen = roundState === PredictionRoundState.OPEN;
  const isRoundLocked = roundState === PredictionRoundState.LOCKED;
  const isClosingSoon = isRoundOpen && episodeStatus === "recording";
  const missedPickCount = totalPickCount - savedPickCount;
  const remainingSeconds =
    closesAt === null ? 0 : Math.max(0, Math.ceil((closesAt - now) / 1000));
  const gridStyle = { "--ratings": data.ratings.length } as CSSProperties;
  const scoring = [
    { points: data.scoring.correctHost, label: "per correct host" },
    { points: data.scoring.allCorrectBonus, label: "bonus for all correct" },
    { points: data.scoring.allIncorrect, label: "if every pick misses" },
  ].filter(
    (rule): rule is { points: number; label: string } => rule.points !== null
  );

  const status = (
    <>
      <span
        className={cn(
          "inline-flex items-center gap-2 whitespace-nowrap font-bold before:h-2 before:w-2 before:rounded-full",
          isClosingSoon
            ? "text-amber-200 before:bg-amber-400"
            : isRoundOpen
            ? "text-emerald-300 before:bg-emerald-400"
            : "text-zinc-300 before:bg-zinc-500"
        )}
      >
        {isClosingSoon
          ? "Closing soon"
          : isRoundOpen
          ? "Open"
          : isRoundLocked
          ? "Locked"
          : "Not open yet"}
      </span>
      {isClosingSoon ? (
        <span>
          <b className="tabular-nums text-white">
            {formatCountdown(remainingSeconds)}
          </b>{" "}
          left to pick and wager
        </span>
      ) : isRoundOpen ? (
        <span>Locks 10 min after recording starts</span>
      ) : isRoundLocked ? (
        <span>Picks and wagers are final</span>
      ) : null}
    </>
  );

  return sheet(
    <>
      {!isRoundOpen && !isRoundLocked ? (
        <GameSheetRow>
          <p className="font-bold text-white">
            Picks aren’t open for this episode yet.
          </p>
        </GameSheetRow>
      ) : totalPickCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-white/10 px-4 py-3 text-sm sm:px-6">
          {totalPickCount <= 12 ? (
            <div className="flex gap-1" aria-hidden="true">
              {Array.from({ length: totalPickCount }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1.5 w-5 rounded-full sm:w-7",
                    index < savedPickCount ? "bg-zinc-100" : "bg-white/[0.12]"
                  )}
                />
              ))}
            </div>
          ) : null}
          <p className="text-zinc-300" aria-live="polite">
            <b className="text-white">
              {savedPickCount} of {totalPickCount}
            </b>{" "}
            picks {isRoundLocked ? "locked in" : "saved"}
            {isRoundLocked && missedPickCount > 0
              ? ` · you missed ${missedPickCount}`
              : null}
          </p>
          {savedPickCount === totalPickCount ? (
            <span className="ml-auto inline-flex items-center gap-1.5 font-bold text-emerald-300">
              <Check className="h-4 w-4" aria-hidden="true" />
              All picks complete
            </span>
          ) : null}
        </div>
      ) : null}

      {loadError !== null ? (
        <GameSheetRow className="text-red-100" role="alert">
          {loadError} Your currently displayed choices have not been changed.
        </GameSheetRow>
      ) : null}

      <div className="border-t border-white/10" style={gridStyle}>
        {isRoundOpen || isRoundLocked ? (
          <div
            className={cn(
              scorecardGrid,
              "sticky top-16 z-10 border-b border-white/10 bg-[color:var(--bbpc-surface-raised)] py-2.5"
            )}
          >
            <span />
            {data.ratings.map((rating) => (
              <div
                key={rating.id}
                className="flex min-w-0 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-bold text-white sm:flex-row sm:gap-2 sm:text-[0.8125rem]"
              >
                <RatingIcon value={rating.value} />
                <span className="max-w-full truncate">{rating.name}</span>
                {rating.category ? (
                  <span className="hidden font-medium text-zinc-400 lg:inline">
                    {rating.category}
                  </span>
                ) : null}
              </div>
            ))}
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
                const existing =
                  current.guessesByAssignment[assignment.id] ?? [];
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
      </div>
    </>,
    status,
    scoring.length > 0 ? (
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-white/10 bg-black/20 px-4 py-3.5 text-[0.8125rem] text-zinc-400 sm:px-6">
        {scoring.map((rule) => (
          <div key={rule.label} className="flex gap-1.5">
            <dt className="order-2">{rule.label}</dt>
            <dd className="font-bold tabular-nums text-white">
              {rule.points > 0 ? "+" : rule.points < 0 ? "−" : ""}
              {Math.abs(rule.points)}
            </dd>
          </div>
        ))}
      </dl>
    ) : null
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
  onGuessSaved: (guess: ConvexPredictionGuess) => void;
  onSavingChange: (hostId: string | null) => void;
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
  onGuessSaved,
  onSavingChange,
}) => {
  const convex = useConvex();
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [hasOpenedVoice, setHasOpenedVoice] = useState(false);
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
  const roundState = getPredictionRoundState(
    episodeStatus,
    assignment.playable,
    closesAt,
    now
  );
  const isRoundOpen = roundState === PredictionRoundState.OPEN;
  const isUnplayable = !assignment.playable;
  // An unopened round has no grid yet; a locked one keeps it, read-only.
  const showsGrid =
    !isUnplayable && roundState !== PredictionRoundState.UNAVAILABLE;
  const movieTitle = assignment.movie?.title ?? "Unknown movie";

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

  const failedHost = hosts.find((host) => host.id === failedPick?.hostId);

  return (
    <article className="border-t border-white/10 py-4 first-of-type:border-t-0">
      <div className="flex items-center gap-3 px-4 sm:px-6">
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
        <h3 className="min-w-0 break-words text-[1.0625rem] font-extrabold leading-tight text-white">
          {assignment.movie
            ? highlightText(assignment.movie.title, searchQuery)
            : movieTitle}
        </h3>
        <div className="ml-auto flex shrink-0 items-center gap-3 text-[0.8125rem] font-bold sm:gap-4">
          {savingHostId !== null ? (
            <span className="text-amber-200">Saving…</span>
          ) : isUnplayable ? (
            <span className="font-medium text-zinc-400">Not in the game</span>
          ) : !showsGrid ? null : allPicksSaved ? (
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              All picked
            </span>
          ) : isRoundOpen ? (
            <span className="text-amber-200">
              {hosts.length - selectedCount} to go
            </span>
          ) : (
            <span className="font-medium text-zinc-400">
              {selectedCount === 0
                ? "No picks made"
                : `${selectedCount} of ${hosts.length} picked`}
            </span>
          )}
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-end gap-1.5 rounded-md text-zinc-300 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            aria-expanded={isVoiceOpen}
            aria-label={`Voice message for ${movieTitle}`}
            onClick={() => {
              setHasOpenedVoice(true);
              setIsVoiceOpen((value) => !value);
            }}
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Voice message</span>
          </button>
        </div>
      </div>

      {hasOpenedVoice ? (
        <div hidden={!isVoiceOpen} className="px-4 pt-1.5 sm:px-6">
          <ConvexAssignmentVoiceMessages
            assignmentId={assignment.id}
            isVisible={isVoiceOpen}
            title={
              assignment.movie
                ? `Voice message for ${assignment.movie.title}`
                : "Assignment voice message"
            }
          />
        </div>
      ) : null}

      {showsGrid
        ? hosts.map((host) => {
            const hostName = host.name ?? "Host";
            const guess =
              optimisticGuess?.hostId === host.id
                ? optimisticGuess
                : findGuessForHost(guesses, host.id);
            if (!isRoundOpen) {
              return (
                <div key={host.id} className={cn(scorecardGrid, "mt-1.5")}>
                  <div className="min-w-0 pr-1">
                    <span className="block break-words text-sm font-bold leading-tight text-white sm:text-[0.9375rem]">
                      {hostName}
                    </span>
                    {guess ? null : (
                      <span className="block text-xs font-semibold text-zinc-400">
                        No pick
                      </span>
                    )}
                  </div>
                  {ratings.map((rating) =>
                    guess?.rating.id === rating.id ? (
                      <span
                        key={rating.id}
                        className={cn(
                          "flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border text-sm font-bold text-white",
                          pickedTone[rating.value] ??
                            "border-red-400 bg-red-500/15"
                        )}
                      >
                        <PickedRating rating={rating} />
                      </span>
                    ) : (
                      <span
                        key={rating.id}
                        className="flex h-11 items-center justify-center rounded-lg border border-dashed border-white/[0.09]"
                        aria-hidden="true"
                      >
                        <span className="h-1 w-1 rounded-full bg-white/20" />
                      </span>
                    )
                  )}
                </div>
              );
            }
            const isSaving = savingHostId === host.id;
            const didFail = failedPick?.hostId === host.id;
            const isSaved = !isSaving && !didFail && Boolean(guess?.rating.id);
            return (
              <fieldset
                key={host.id}
                className={cn(scorecardGrid, "mt-1.5 min-w-0")}
                disabled={savingHostId !== null}
              >
                <legend className="sr-only">{hostName}</legend>
                <div className="min-w-0 pr-1">
                  <span
                    className="block break-words text-sm font-bold leading-tight text-white sm:text-[0.9375rem]"
                    aria-hidden="true"
                  >
                    {hostName}
                  </span>
                  <span
                    className={cn(
                      "sr-only text-xs font-semibold",
                      !isSaved && "sm:not-sr-only",
                      didFail ? "text-red-300" : "text-amber-200"
                    )}
                    aria-live="polite"
                  >
                    {isSaving
                      ? "Saving…"
                      : didFail
                      ? "Not saved"
                      : isSaved
                      ? lastSavedHostId === host.id
                        ? "Saved just now"
                        : "Saved"
                      : "Pick"}
                  </span>
                </div>
                {ratings.map((rating) => {
                  const isSelected = guess?.rating.id === rating.id;
                  const hasIcon = hasRatingIcon(rating.value);
                  return (
                    <label
                      key={rating.id}
                      className="group min-w-0 cursor-pointer"
                      title={rating.name}
                    >
                      <input
                        type="radio"
                        name={`convex-prediction-${assignment.id}-${host.id}`}
                        value={rating.id}
                        checked={isSelected}
                        onChange={() => void chooseRating(host.id, rating.id)}
                        disabled={savingHostId !== null}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          "flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border text-sm font-bold transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-red-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black",
                          isSelected
                            ? cn(
                                "text-white",
                                pickedTone[rating.value] ??
                                  "border-red-400 bg-red-500/15"
                              )
                            : "border-transparent bg-white/[0.035] text-zinc-400 hover:border-white/25 hover:bg-white/[0.07]",
                          savingHostId !== null && "cursor-not-allowed",
                          isSaving && "opacity-50"
                        )}
                      >
                        {isSelected ? (
                          <PickedRating rating={rating} />
                        ) : (
                          <>
                            {hasIcon ? (
                              // Every empty cell names its rating, so a pick
                              // never depends on the legend being in view.
                              <span className="opacity-60 transition-opacity group-hover:opacity-100">
                                <RatingIcon value={rating.value} />
                              </span>
                            ) : null}
                            <span className={hasIcon ? "sr-only" : namedCell}>
                              {rating.name}
                            </span>
                          </>
                        )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            );
          })
        : null}

      {errorMessage !== null && failedPick !== null ? (
        <div
          className="mx-4 mt-2.5 flex flex-col gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] py-2 pl-3 pr-2 sm:mx-6 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="text-sm text-red-100">
            <b>{failedHost?.name ?? "Host"}:</b> {errorMessage}
          </p>
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

      {!showsGrid ? null : hasAllGuesses ? (
        <fieldset
          className="mx-4 mt-3 min-w-0 border-t border-dashed border-white/10 pt-1 sm:mx-6"
          disabled={savingHostId !== null}
          aria-label="Wager options"
        >
          {savingHostId !== null ? (
            <p role="status" className="pt-2 text-sm text-amber-200">
              Wagering will be available after your pick finishes saving.
            </p>
          ) : null}
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
      ) : isRoundOpen ? (
        <p className="mx-4 mt-3 flex min-h-12 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-dashed border-white/10 pt-1 text-sm text-zinc-400 sm:mx-6">
          <span className="bbpc-label sm:w-16">Wager</span>
          Optional. Opens when{" "}
          {hosts.length === 1
            ? "your pick is in."
            : `all ${hosts.length} picks are in.`}
        </p>
      ) : null}
    </article>
  );
};
