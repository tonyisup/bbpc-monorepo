"use client";

import { useConvex } from "convex/react";
import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  Play,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { VoiceVisualizer } from "@/components/common/VoiceVisualizer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  BBPC_CLIENT_API_VERSION,
  getConvexDomainErrorCode,
} from "@/convex/identity";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useUploadThing } from "@/utils/uploadthing";

const episodeSchema = z.object({
  id: z.string().min(1),
  number: z.number().finite(),
  title: z.string(),
});

const audioMessageSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  createdAt: z.number().finite(),
  fileKey: z.string().nullable(),
  episodeId: z.string().nullable(),
  notes: z.string().nullable(),
});

const audioPageSchema = z.object({
  page: z.array(audioMessageSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
});

const audioUsageSchema = z.object({
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  canUpload: z.boolean(),
});

type Episode = z.infer<typeof episodeSchema>;
type AudioMessage = z.infer<typeof audioMessageSchema>;
type AudioUsage = z.infer<typeof audioUsageSchema>;

const nextEpisodeReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>(
  "episodes/public:nextScheduled"
);
const listMineReference = makeFunctionReference<
  "query",
  {
    episodeId: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  unknown
>("episodes/audio:listMine");
const usageReference = makeFunctionReference<
  "query",
  { episodeId: string },
  unknown
>("episodes/audio:usageForEpisode");
const createMineReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    url: string;
    fileKey: string;
    createdAt: number;
    notes?: string;
  },
  unknown
>("episodes/audio:createMine");
const deleteMineReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("episodes/audio:deleteMine");
const discardUploadReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    fileKey: string;
    uploadId: string;
  },
  unknown
>("episodes/audio:discardMyUpload");

function messageForError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Voice messages are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "The recording could not be saved because the episode changed or your message limit was reached.";
    case "VALIDATION_FAILED":
      return "The recording metadata is invalid. Please record it again.";
    default:
      return "Couldn’t save the voice message. Check your connection and retry.";
  }
}

async function loadAudioState(
  convex: ConvexReactClient,
  episodeId: string
): Promise<{ messages: AudioMessage[]; usage: AudioUsage }> {
  const [page, usage] = await Promise.all([
    convex.query(listMineReference, {
      episodeId,
      paginationOpts: { cursor: null, numItems: 50 },
    }),
    convex.query(usageReference, { episodeId }),
  ]);
  const parsedPage = audioPageSchema.parse(page);
  if (!parsedPage.isDone) {
    throw new Error("episode-audio-page-exceeds-client-limit");
  }
  return {
    messages: parsedPage.page,
    usage: audioUsageSchema.parse(usage),
  };
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;
}

function ConvexEpisodeVoiceMailRecorder({ episode }: { episode: Episode }) {
  const convex = useConvex();
  const [messages, setMessages] = useState<AudioMessage[]>([]);
  const [usage, setUsage] = useState<AudioUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showRecordings, setShowRecordings] = useState(false);
  const [notes, setNotes] = useState("");
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
  } = useAudioRecorder({ serviceWorkerIntegration: true });
  const { startUpload, isUploading } = useUploadThing("audioUploader");

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await loadAudioState(convex, episode.id);
      setMessages(next.messages);
      setUsage(next.usage);
      setErrorMessage(null);
      return next;
    } catch {
      setErrorMessage("Couldn’t load your voice messages.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [convex, episode.id]);

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
      const extension =
        audioBlob.type.split("/")[1]?.split(";")[0] ?? "webm";
      const createdAt = Date.now();
      const file = new File(
        [audioBlob],
        `episode-${episode.id}-voice-${createdAt}.${extension}`,
        { type: audioBlob.type }
      );
      uploadedFile = (await startUpload([file], { episodeId: episode.id }))?.[0];
      if (
        uploadedFile === undefined ||
        uploadedFile.key.length === 0 ||
        uploadedFile.url.length === 0
      ) {
        throw new Error("episode-audio-upload-failed");
      }
      audioMessageSchema.parse(
        await convex.mutation(createMineReference, {
          clientApiVersion: BBPC_CLIENT_API_VERSION,
          episodeId: episode.id,
          url: uploadedFile.url,
          fileKey: uploadedFile.key,
          createdAt,
          ...(notes.trim().length === 0 ? {} : { notes: notes.trim() }),
        })
      );
      setNotes("");
      resetRecording();
      await reload();
      toast.success("Voice message submitted");
    } catch (error) {
      if (uploadedFile !== undefined) {
        const adopted = await loadAudioState(convex, episode.id).catch(
          () => null
        );
        if (
          adopted?.messages.some(
            (message) => message.fileKey === uploadedFile?.key
          )
        ) {
          setMessages(adopted.messages);
          setUsage(adopted.usage);
          setNotes("");
          resetRecording();
          toast.success("Voice message submitted");
          setIsSubmitting(false);
          return;
        }
        try {
          await convex.mutation(discardUploadReference, {
            clientApiVersion: BBPC_CLIENT_API_VERSION,
            episodeId: episode.id,
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
      setErrorMessage(messageForError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const remove = async (message: AudioMessage) => {
    if (!window.confirm("Delete this recording?")) return;
    setDeletingId(message.id);
    setErrorMessage(null);
    try {
      await convex.mutation(deleteMineReference, {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id: message.id,
      });
      setMessages((current) =>
        current.filter((candidate) => candidate.id !== message.id)
      );
      setUsage((current) =>
        current === null
          ? null
          : {
              ...current,
              count: Math.max(0, current.count - 1),
              canUpload: true,
            }
      );
      toast.success("Recording deleted");
    } catch (error) {
      setErrorMessage(messageForError(error));
    } finally {
      setDeletingId(null);
    }
  };

  const busy = isSubmitting || isUploading;
  const canUpload = usage?.canUpload ?? false;

  return (
    <div className="w-full space-y-4">
      <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
        <p className="font-semibold">Episode {episode.number}</p>
        <p className="text-muted-foreground">{episode.title}</p>
      </div>

      <button
        type="button"
        onClick={() => setShowRecordings((current) => !current)}
        className="flex w-full items-center justify-between rounded p-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <span className="flex items-center gap-1 font-medium">
          {showRecordings ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Your recordings: {isLoading ? "…" : messages.length}
        </span>
        {usage !== null ? (
          <span className="text-xs">
            {usage.count}/{usage.limit}
          </span>
        ) : null}
      </button>

      {showRecordings && messages.length > 0 ? (
        <div className="max-h-48 space-y-2 overflow-y-auto border-l-2 border-muted pl-2">
          {messages.map((message, index) => (
            <div
              key={message.id}
              className="space-y-1 rounded-md bg-muted/40 p-2"
            >
              <div className="flex items-center gap-2">
                <audio
                  controls
                  preload="none"
                  src={message.url}
                  className="h-9 min-w-0 flex-1"
                  aria-label={`Saved recording ${index + 1}`}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete saved recording ${index + 1}`}
                  disabled={deletingId !== null}
                  onClick={() => void remove(message)}
                >
                  {deletingId === message.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {message.notes !== null ? (
                <p className="text-xs text-muted-foreground">{message.notes}</p>
              ) : null}
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

      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-muted-foreground/20 bg-muted/50 p-3 text-center">
        {isRecording ? (
          <div className="flex flex-col items-center">
            <VoiceVisualizer
              volume={volume}
              isRecording={isRecording}
              className="mb-2"
            />
            <span className="font-bold text-red-500">
              Recording {formatTime(recordingTime)}
            </span>
          </div>
        ) : audioBlob !== null ? (
          <span className="text-sm text-muted-foreground">
            Ready to send · {formatTime(recordingTime)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Record a short message for the next episode.
          </span>
        )}
      </div>

      <Textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        maxLength={5000}
        placeholder="Add a note for the hosts (optional)…"
        className="min-h-20 resize-none"
      />

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
          <Button type="button" variant="outline" onClick={resetRecording}>
            <X className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
          <Button
            type="button"
            variant="outline"
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
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
            ) : (
              <Send className="h-4 w-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          className="w-full"
          disabled={isLoading || !canUpload}
          onClick={startRecording}
        >
          <Mic className="mr-2 h-4 w-4" />
          {canUpload ? "Record voice message" : "Recording limit reached"}
        </Button>
      )}

      {errorMessage !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export function ConvexVoiceMailRecorder({ enabled }: { enabled: boolean }) {
  const convex = useConvex();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setIsLoading(true);
    setErrorMessage(null);
    void convex
      .query(nextEpisodeReference, {})
      .then((result) => {
        if (active) setEpisode(result === null ? null : episodeSchema.parse(result));
      })
      .catch(() => {
        if (active) setErrorMessage("Episode details could not be loaded.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [convex, enabled]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading episode details…
      </div>
    );
  }
  if (errorMessage !== null) {
    return (
      <div className="p-8 text-center text-destructive" role="alert">
        {errorMessage}
      </div>
    );
  }
  if (episode === null) {
    return (
      <div className="p-8 text-center text-muted-foreground" role="status">
        No upcoming episode is available for voice messages.
      </div>
    );
  }
  return <ConvexEpisodeVoiceMailRecorder episode={episode} />;
}
