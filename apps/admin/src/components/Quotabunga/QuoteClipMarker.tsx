import { parseYouTubeUrl, youtubeWatchUrl } from "@bbpc/youtube";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";
import {
  formatClipTime,
  MAX_CLIP_SECONDS,
  parseClipTime,
  tenths,
} from "@/lib/clipTimes";
import { useYouTubePlayer } from "@/lib/useYouTubePlayer";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { listenerName } from "./ListenerNames";

const SPEEDS = [1, 0.75, 0.5] as const;
// "Play the marked line" runs a little past the end so the last word lands.
const PREVIEW_TAIL_SECONDS = 0.3;
const PREVIEW_WITHOUT_END_SECONDS = 4;
// Each clip is cued this far before its start, so the lead-in is audible.
const CUE_LEAD_SECONDS = 1;
// Seek steps, shared by the transport buttons and the keyboard shortcuts.
const FINE_STEP = 0.2;
const STEP = 1;
const COARSE_STEP = 5;
const BACK_STEPS = [
  [-COARSE_STEP, "Shift+Left"],
  [-STEP, "Left"],
  [-FINE_STEP, ","],
] as const;
const FORWARD_STEPS = [
  [FINE_STEP, "."],
  [STEP, "Right"],
  [COARSE_STEP, "Shift+Right"],
] as const;

/**
 * What onSave throws when the entry changed since the marker loaded it (a
 * listener can edit it while the round is open), carrying the latest version,
 * or null once it has been deleted. The marker shows that version in place.
 */
export class EntryChangedError extends Error {
  readonly latest: ConvexAdminQuoteSubmission | null;

  constructor(latest: ConvexAdminQuoteSubmission | null) {
    super(
      latest === null
        ? "This entry was deleted, so its clip times weren't saved."
        : "A listener changed this entry after the marker loaded it. Their latest version is shown now; check the clip and save again."
    );
    this.name = "EntryChangedError";
    this.latest = latest;
  }
}

export interface ClipTimes {
  start: number;
  end: number | null;
}

interface Draft {
  start: string;
  end: string;
}

interface QuoteClipMarkerProps {
  /** Entries with a YouTube link, in the order the page shows them. */
  queue: ConvexAdminQuoteSubmission[];
  initialId: string;
  /** Saves the times; rejects with an Error whose message can be shown. */
  onSave: (
    submission: ConvexAdminQuoteSubmission,
    times: ClipTimes
  ) => Promise<ConvexAdminQuoteSubmission>;
  onDirtyChange?: (dirty: boolean) => void;
  /** Closes the marker; shown as a Done button. */
  onDone?: () => void;
  /** True while another prompt is open over the marker; shortcuts wait. */
  paused?: boolean;
  /** False while listener names are hidden for blind judging. */
  showListener?: boolean;
}

/**
 * The content update that saves marked times. Everything else about the entry
 * is sent back unchanged, and the link is rewritten to open at the new start,
 * as the listener's own form saves it.
 */
export function clipTimesUpdate(
  submission: ConvexAdminQuoteSubmission,
  videoId: string,
  times: ClipTimes
) {
  return {
    id: submission.id,
    quoteText: submission.quoteText,
    sourceTitle: submission.sourceTitle,
    sourceType: submission.sourceType,
    clipUrl: youtubeWatchUrl(videoId, times.start),
    clipStartSeconds: times.start,
    // Backends before clip ranges reject this argument, so send it only to
    // set an end or clear a saved one.
    ...(times.end === null && submission.clipEndSeconds === null
      ? {}
      : { clipEndSeconds: times.end }),
    listenerNotes: submission.listenerNotes,
    adminNotes: submission.adminNotes,
  };
}

function savedDraft(submission: ConvexAdminQuoteSubmission): Draft {
  return {
    start:
      submission.clipStartSeconds === null
        ? ""
        : formatClipTime(submission.clipStartSeconds),
    end:
      submission.clipEndSeconds === null
        ? ""
        : formatClipTime(submission.clipEndSeconds),
  };
}

function savedRange(submission: ConvexAdminQuoteSubmission): string {
  if (submission.clipStartSeconds === null) return "no start time";
  const start = formatClipTime(submission.clipStartSeconds);
  return submission.clipEndSeconds === null
    ? `starts at ${start}, no end`
    : `${start} to ${formatClipTime(submission.clipEndSeconds)}`;
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-2 rounded border border-current px-1 font-mono text-[10px] leading-4 opacity-70">
      {children}
    </kbd>
  );
}

/**
 * Plays each entry's YouTube clip so an admin can mark where the line is
 * spoken, then saves the start and end with a link that opens at the start.
 */
export function QuoteClipMarker({
  queue,
  initialId,
  onSave,
  onDirtyChange,
  onDone,
  paused = false,
  showListener = true,
}: QuoteClipMarkerProps) {
  const [entries, setEntries] = useState(queue);
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      queue.findIndex((submission) => submission.id === initialId)
    )
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [speed, setSpeed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const entry = entries[index];
  const video = parseYouTubeUrl(entry?.clipUrl ?? "");
  const videoId = video?.id ?? "";
  // A clip saved without a start cues from its link's own start instead.
  const startAt = Math.max(
    0,
    (entry?.clipStartSeconds ?? video?.start ?? 0) - CUE_LEAD_SECONDS
  );
  const player = useYouTubePlayer(videoId, startAt);
  const { ready, error, currentTime, duration, playing } = player.state;
  const draft =
    entry === undefined
      ? { start: "", end: "" }
      : drafts[entry.id] ?? savedDraft(entry);

  const dirtyCount = entries.filter((submission) => {
    const pending = drafts[submission.id];
    if (pending === undefined) return false;
    const saved = savedDraft(submission);
    return pending.start !== saved.start || pending.end !== saved.end;
  }).length;
  useEffect(() => {
    onDirtyChange?.(dirtyCount > 0);
  }, [dirtyCount, onDirtyChange]);

  const rate = SPEEDS[speed] ?? 1;
  const setRate = player.setRate;
  useEffect(() => {
    if (ready) setRate(rate);
  }, [ready, rate, setRate]);

  // Two entries can share a video, which then doesn't reload, so a change of
  // entry cues the playhead itself.
  const entryId = entry?.id;
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;
  const seek = player.seek;
  useEffect(() => {
    seek(startAtRef.current);
  }, [entryId, seek]);

  const updateDraft = (change: Partial<Draft>) => {
    if (entry === undefined) return;
    setDrafts((current) => ({
      ...current,
      [entry.id]: { ...draft, ...change },
    }));
  };

  const mark = (field: "start" | "end") => {
    if (!ready) return;
    const time = tenths(player.currentTime());
    const end = parseClipTime(draft.end);
    updateDraft(
      field === "start" && end !== null && !(end > time)
        ? { start: formatClipTime(time), end: "" }
        : { [field]: formatClipTime(time) }
    );
    setMessage({
      text: `${field === "start" ? "Start" : "End"} set to ${formatClipTime(
        time
      )}.`,
      error: false,
    });
  };

  const readTimes = (): ClipTimes | string => {
    const start = parseClipTime(draft.start);
    const end = parseClipTime(draft.end);
    if (start === null) return "Set a start first.";
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return "Times look like 1:05.2 or 65.2.";
    }
    if (start > MAX_CLIP_SECONDS || (end !== null && end > MAX_CLIP_SECONDS)) {
      return `Clip times must be within ${String(
        MAX_CLIP_SECONDS / 3600
      )} hours.`;
    }
    if (end !== null && end <= start) {
      return "The end must be after the start.";
    }
    if (duration > 0 && start >= duration) {
      return "The start is past the end of the video.";
    }
    return { start, end };
  };

  const preview = () => {
    const times = readTimes();
    if (typeof times === "string") {
      setMessage({ text: times, error: true });
      return;
    }
    player.playUntil(
      times.start,
      (times.end ?? times.start + PREVIEW_WITHOUT_END_SECONDS) +
        PREVIEW_TAIL_SECONDS
    );
  };

  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= entries.length) return;
    setIndex(next);
    setMessage(null);
  };

  // A finished save checks whether the admin moved on while it was in flight.
  const indexRef = useRef(index);
  indexRef.current = index;

  const save = async (advance: boolean) => {
    if (entry === undefined || saving) return;
    const times = readTimes();
    if (typeof times === "string") {
      setMessage({ text: times, error: true });
      return;
    }
    const savedIndex = index;
    const savedMarks = draft;
    setSaving(true);
    try {
      const updated = await onSave(entry, times);
      setEntries((current) =>
        current.map((submission) =>
          submission.id === updated.id ? updated : submission
        )
      );
      // Marks typed while the save was in flight are kept.
      setDrafts((current) => {
        const pending = current[updated.id];
        if (
          pending !== undefined &&
          (pending.start !== savedMarks.start || pending.end !== savedMarks.end)
        ) {
          return current;
        }
        const next = { ...current };
        delete next[updated.id];
        return next;
      });
      const range = savedRange(updated);
      // An admin who moved on during the save stays where they went.
      if (indexRef.current !== savedIndex) {
        setMessage({
          text: `Saved clip ${String(savedIndex + 1)}: ${range}.`,
          error: false,
        });
      } else if (advance && savedIndex < entries.length - 1) {
        setIndex(savedIndex + 1);
        setMessage({
          text: `Saved the previous clip: ${range}.`,
          error: false,
        });
      } else {
        setMessage({
          text: advance
            ? `Saved: ${range}. That was the last clip in this view.`
            : `Saved: ${range}.`,
          error: false,
        });
      }
    } catch (failure) {
      if (failure instanceof EntryChangedError) {
        const latest = failure.latest;
        if (latest === null) {
          const removed = entries.findIndex(
            (submission) => submission.id === entry.id
          );
          setEntries((current) =>
            current.filter((submission) => submission.id !== entry.id)
          );
          // Stay on the same clip; entries after the removed one move up.
          setIndex((current) =>
            Math.max(
              0,
              Math.min(
                current > removed ? current - 1 : current,
                entries.length - 2
              )
            )
          );
        } else {
          // The admin's marks stay as drafts against the latest version.
          setEntries((current) =>
            current.map((submission) =>
              submission.id === latest.id ? latest : submission
            )
          );
        }
      }
      const reason =
        failure instanceof Error
          ? failure.message
          : "The clip times weren't saved.";
      setMessage({
        text:
          indexRef.current === savedIndex
            ? reason
            : `Clip ${String(savedIndex + 1)} wasn't saved: ${reason}`,
        error: true,
      });
    } finally {
      setSaving(false);
    }
  };

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Shortcuts read the latest render's actions through this ref.
  const shortcuts = useRef<Record<string, (event: KeyboardEvent) => void>>({});

  shortcuts.current = {
    " ": () => player.togglePlay(),
    ArrowLeft: (event) =>
      player.seek(player.currentTime() - (event.shiftKey ? COARSE_STEP : STEP)),
    ArrowRight: (event) =>
      player.seek(player.currentTime() + (event.shiftKey ? COARSE_STEP : STEP)),
    ",": () => player.seek(player.currentTime() - FINE_STEP),
    ".": () => player.seek(player.currentTime() + FINE_STEP),
    s: () => mark("start"),
    e: () => mark("end"),
    p: preview,
    Enter: () => void save(true),
    j: () => go(1),
    k: () => go(-1),
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pausedRef.current) return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (event.altKey) return;
      const target = event.target as Element | null;
      const inside = (selector: string) =>
        typeof target?.closest === "function" &&
        target.closest(selector) !== null;
      // Typing stays typing, and a control reached with Tab keeps its keys.
      if (inside("input, textarea, select, [contenteditable='true']")) return;
      if (
        (event.key === " " || event.key === "Enter") &&
        inside("button, a, summary")
      ) {
        return;
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const action = shortcuts.current[key];
      if (action === undefined) return;
      event.preventDefault();
      action(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // A clicked control lets go of focus so Space and Enter stay shortcuts.
  const releaseClickedButton = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail === 0) return;
    const control = (event.target as Element).closest?.("button, a, summary");
    (control as HTMLElement | null | undefined)?.blur();
  };

  const stepButton = ([step, key]: readonly [number, string]) => {
    const size = Math.abs(step);
    const title = `${step < 0 ? "Back" : "Forward"} ${String(size)} second${
      size === 1 ? "" : "s"
    } (${key})`;
    const label = `${step < 0 ? "−" : "+"}${String(size)}`;
    return (
      <Button
        aria-label={title}
        disabled={!ready}
        key={label}
        onClick={() => player.seek(player.currentTime() + step)}
        size="sm"
        title={title}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
    );
  };

  if (entry === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        No entries with a YouTube link in this view.
      </p>
    );
  }

  const openAt = parseClipTime(draft.start);
  const youtubeLink = youtubeWatchUrl(
    videoId,
    typeof openAt === "number" && !Number.isNaN(openAt) ? openAt : null
  );

  return (
    <div className="space-y-4" onClick={releaseClickedButton}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Clip {index + 1} of {entries.length}
          {showListener && ` · ${listenerName(entry)}`}
          {dirtyCount > 0 && (
            <span className="ml-2 text-amber-700 dark:text-amber-300">
              {dirtyCount} unsaved
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            disabled={index === 0}
            onClick={() => go(-1)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Previous
          </Button>
          <Button
            disabled={index === entries.length - 1}
            onClick={() => go(1)}
            size="sm"
            type="button"
            variant="outline"
          >
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        <blockquote className="whitespace-pre-wrap text-xl font-semibold leading-snug">
          &ldquo;{entry.quoteText}&rdquo;
        </blockquote>
        <p className="mt-1 text-sm text-muted-foreground">
          {entry.sourceTitle} · Saved clip: {savedRange(entry)}
        </p>
      </div>

      {/* Capped by the viewport height so the marks stay on screen. */}
      <div className="relative mx-auto aspect-video w-full max-w-[70vh] overflow-hidden rounded-md bg-black">
        <div
          className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full"
          ref={player.container}
        />
      </div>
      {!ready && error.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          Loading the YouTube player…
        </p>
      )}
      {error.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
          role="alert"
        >
          <span>
            {error} Open it on YouTube and type the times in, or try again.
          </span>
          <Button
            onClick={player.retry}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Retry
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {BACK_STEPS.map(stepButton)}
        <Button
          className="min-w-24"
          disabled={!ready}
          onClick={player.togglePlay}
          size="sm"
          title="Play or pause (Space)"
          type="button"
        >
          {playing ? (
            <Pause className="mr-1 h-4 w-4" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          {playing ? "Pause" : "Play"}
        </Button>
        {FORWARD_STEPS.map(stepButton)}
        <Button
          aria-label={`Playback speed ${String(rate)}×`}
          onClick={() => setSpeed((value) => (value + 1) % SPEEDS.length)}
          size="sm"
          title="Playback speed"
          type="button"
          variant="outline"
        >
          {rate}×
        </Button>
        <span className="ml-auto font-mono text-lg font-semibold tabular-nums">
          {formatClipTime(currentTime)}
          <span className="text-sm font-normal text-muted-foreground">
            {" "}
            / {formatClipTime(duration)}
          </span>
        </span>
      </div>
      <input
        aria-label="Seek video"
        className="w-full accent-primary"
        disabled={!ready || duration <= 0}
        max={duration}
        min={0}
        onChange={(event) => player.seek(Number(event.target.value))}
        step={0.1}
        type="range"
        value={Math.min(currentTime, duration)}
      />

      <form
        className="space-y-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void save(true);
        }}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <label
              className="text-sm font-semibold"
              htmlFor="clip-marker-start"
            >
              Start
            </label>
            <Input
              autoComplete="off"
              className="w-24"
              id="clip-marker-start"
              inputMode="decimal"
              onChange={(event) => updateDraft({ start: event.target.value })}
              placeholder="M:SS.s"
              value={draft.start}
            />
            <Button
              disabled={!ready}
              onClick={() => mark("start")}
              size="sm"
              type="button"
              variant="outline"
            >
              Set start <Key>S</Key>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold" htmlFor="clip-marker-end">
              End
            </label>
            <Input
              autoComplete="off"
              className="w-24"
              id="clip-marker-end"
              inputMode="decimal"
              onChange={(event) => updateDraft({ end: event.target.value })}
              placeholder="optional"
              value={draft.end}
            />
            <Button
              disabled={!ready}
              onClick={() => mark("end")}
              size="sm"
              type="button"
              variant="outline"
            >
              Set end <Key>E</Key>
            </Button>
          </div>
          <Button
            disabled={!ready}
            onClick={preview}
            size="sm"
            type="button"
            variant="outline"
          >
            Play the marked line <Key>P</Key>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline"
            href={youtubeLink}
            rel="noreferrer noopener"
            target="_blank"
          >
            Open on YouTube <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <div className="ml-auto flex gap-2">
            {onDone !== undefined && (
              <Button onClick={onDone} size="sm" type="button" variant="ghost">
                Done
              </Button>
            )}
            <Button
              disabled={saving}
              onClick={() => void save(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Save
            </Button>
            <Button disabled={saving} size="sm" type="submit">
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save and next <Key>Enter</Key>
            </Button>
          </div>
        </div>
        {message !== null && (
          <p
            className={
              message.error
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
            role={message.error ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
      </form>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">Keyboard and tips</summary>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt>Space</dt>
          <dd>Play or pause</dd>
          <dt>← →</dt>
          <dd>
            Back or forward {STEP} second; with Shift, {COARSE_STEP} seconds
          </dd>
          <dt>, .</dt>
          <dd>Back or forward {FINE_STEP} seconds</dd>
          <dt>S E</dt>
          <dd>Set the start or end at the current time</dd>
          <dt>P</dt>
          <dd>Play from the start to the end</dd>
          <dt>Enter</dt>
          <dd>Save and go to the next clip</dd>
          <dt>J K</dt>
          <dd>Next or previous clip</dd>
          <dt>Esc</dt>
          <dd>Close the marker</dd>
        </dl>
        <p className="mt-2">
          Set the start where the first word begins, not where the scene starts.
          A time set while playing lands a little late: slow the video down,
          step back with the comma key, and check with P. Shortcuts pause while
          the YouTube player has focus; click outside it to use them.
        </p>
      </details>
    </div>
  );
}
