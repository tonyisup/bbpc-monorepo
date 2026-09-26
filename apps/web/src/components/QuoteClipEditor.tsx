"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  formatClipTime,
  MAX_CAPTION_BYTES,
  MAX_CLIP_SECONDS,
  MAX_QUOTE_TEXT_LENGTH,
  parseCaptions,
  selectCueRange,
  validClipRange,
  type TranscriptCue,
} from "@/lib/quoteClip";
import { loadYouTubeAPI, type YouTubePlayer } from "@/lib/youtubePlayer";

type Props = {
  videoId: string;
  initialStart: number;
  start: number | null;
  end: number | null;
  onRangeChange: (start: number, end: number) => void;
  onQuoteChange: (text: string) => void;
  onDurationChange?: (duration: number) => void;
  /** Suggest a 10-second range; only for a video just picked, never a saved clip. */
  seedDefaultRange?: boolean;
};

// Subtitle timing may overrun the player's reported length by a few frames.
const CAPTION_END_TOLERANCE = 0.1;

export function QuoteClipEditor(props: Props) {
  const { videoId, initialStart, start, end, onRangeChange, onQuoteChange } =
    props;
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const previewing = useRef(false);
  const repeatRef = useRef(false);
  const cueAnchor = useRef<number | null>(null);
  const draggingCue = useRef(false);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [retry, setRetry] = useState(0);
  const [playerError, setPlayerError] = useState("");
  const [notice, setNotice] = useState("");
  const [windowStart, setWindowStart] = useState(
    Math.max(0, (start ?? initialStart) - 5)
  );
  const [span, setSpan] = useState(30);
  const [transcriptInput, setTranscriptInput] = useState("");
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const [captionError, setCaptionError] = useState("");
  const [selection, setSelection] = useState<{
    anchor: number;
    focus: number;
  } | null>(null);
  const fileGeneration = useRef(0);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let readyTimeout: number | undefined;
    let instance: YouTubePlayer | null = null;
    let initialized = false;
    let reportedLength = 0;
    setReady(false);
    setPlayerError("");
    const host = container.current;
    void loadYouTubeAPI()
      .then((api) => {
        if (disposed || !host) return;
        const mount = document.createElement("div");
        host.appendChild(mount);
        readyTimeout = window.setTimeout(() => {
          if (!disposed)
            setPlayerError(
              "YouTube is taking too long to respond. Try again or open the video on YouTube."
            );
        }, 20_000);
        instance = new api.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            origin: window.location.origin,
            playsinline: 1,
            start: Math.floor(
              latest.current.start ?? latest.current.initialStart
            ),
          },
          events: {
            onReady: () => {
              if (disposed || !instance) return;
              window.clearTimeout(readyTimeout);
              setPlayerError("");
              player.current = instance;
              setReady(true);
              const poll = () => {
                if (!instance || disposed) return;
                const length = instance.getDuration();
                const time = instance.getCurrentTime();
                const state = instance.getPlayerState();
                if (Number.isFinite(length) && length > 0) {
                  const limit = Math.min(length, MAX_CLIP_SECONDS);
                  setDuration(limit);
                  // Live and not-yet-buffered videos can refine their length.
                  if (limit !== reportedLength) {
                    reportedLength = limit;
                    latest.current.onDurationChange?.(limit);
                  }
                  if (!initialized) {
                    initialized = true;
                    const saved = latest.current;
                    const from =
                      saved.start ??
                      Math.min(saved.initialStart, Math.max(0, limit - 1));
                    if (
                      saved.seedDefaultRange &&
                      saved.end === null &&
                      from < limit
                    )
                      saved.onRangeChange(from, Math.min(limit, from + 10));
                    setWindowStart(
                      Math.min(Math.max(0, from - 5), Math.max(0, limit - 1))
                    );
                  }
                }
                setCurrentTime(Number.isFinite(time) ? time : 0);
                setPlaying(state === 1);
                const range = latest.current;
                if (
                  previewing.current &&
                  range.end !== null &&
                  (time >= range.end || state === 0)
                ) {
                  if (repeatRef.current && range.start !== null) {
                    instance.seekTo(range.start, true);
                    instance.playVideo();
                  } else {
                    previewing.current = false;
                    instance.pauseVideo();
                  }
                }
              };
              poll();
              timer = window.setInterval(poll, 100);
            },
            onError: ({ data }) => {
              if (disposed) return;
              window.clearTimeout(readyTimeout);
              previewing.current = false;
              setReady(false);
              setPlayerError(
                [101, 150].includes(data)
                  ? "This video cannot play here. Open it on YouTube or try another clip."
                  : data === 100
                  ? "This video is private or unavailable. Try another clip."
                  : "YouTube could not play this video. Open it on YouTube or try again."
              );
            },
            onAutoplayBlocked: () => {
              if (!disposed)
                setNotice(
                  "Press play in the YouTube player to begin the preview."
                );
            },
          },
        });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setPlayerError(
            error instanceof Error ? error.message : "YouTube could not load."
          );
      });
    return () => {
      disposed = true;
      fileGeneration.current += 1;
      previewing.current = false;
      if (timer !== undefined) window.clearInterval(timer);
      window.clearTimeout(readyTimeout);
      player.current = null;
      instance?.destroy();
      host?.replaceChildren();
    };
  }, [videoId, retry]);

  const from = start ?? 0;
  const to = end ?? from;
  const limit = duration || MAX_CLIP_SECONDS;
  const windowEnd = Math.min(limit, windowStart + span);
  const windowLength = Math.max(0.1, windowEnd - windowStart);
  const percent = (time: number) =>
    Math.max(0, Math.min(100, ((time - windowStart) / windowLength) * 100));
  const valid =
    start !== null && end !== null && validClipRange(start, end) && to <= limit;
  const visibleCues = useMemo(
    () =>
      cues
        .map((cue, index) => ({ cue, index }))
        .filter(({ cue }) => cue.end > windowStart && cue.start < windowEnd),
    [cues, windowStart, windowEnd]
  );
  const selected = useMemo(
    () =>
      selection
        ? selectCueRange(cues, selection.anchor, selection.focus)
        : null,
    [cues, selection]
  );
  const selectedMatchesRange =
    selected && start === selected.start && end === selected.end;

  function changeRange(nextStart: number, nextEnd: number) {
    previewing.current = false;
    player.current?.pauseVideo();
    onRangeChange(nextStart, nextEnd);
  }

  // Scrubbing passes allowSeekAhead=false so each step doesn't start a new
  // buffer request; the release seeks for real.
  function seek(time: number, allowSeekAhead = true) {
    previewing.current = false;
    player.current?.seekTo(time, allowSeekAhead);
    setCurrentTime(time);
  }

  function timeAt(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(
      windowStart,
      Math.min(
        windowEnd,
        windowStart +
          ((event.clientX - bounds.left) / bounds.width) * windowLength
      )
    );
  }

  function selectCues(anchor: number, focus: number) {
    const range = selectCueRange(cues, anchor, focus);
    if (range.end > limit + CAPTION_END_TOLERANCE) {
      setCaptionError(
        "These subtitles extend beyond the video. Use a transcript from this exact clip."
      );
      return false;
    }
    setCaptionError("");
    setSelection({ anchor, focus });
    changeRange(range.start, Math.min(range.end, limit));
    return true;
  }

  function importCaptions(text: string) {
    try {
      const parsed = parseCaptions(text);
      if (
        duration &&
        parsed.some((cue) => cue.end > duration + CAPTION_END_TOLERANCE)
      ) {
        throw new Error(
          "These subtitles extend beyond the video. Use a transcript from this exact clip."
        );
      }
      setCues(parsed);
      setSelection(null);
      cueAnchor.current = null;
      setCaptionError("");
      setWindowStart(Math.max(0, (parsed[0]?.start ?? 0) - 2));
    } catch (error) {
      setCaptionError(
        error instanceof Error ? error.message : "Could not read the subtitles."
      );
    }
  }

  return (
    <section
      aria-label="Quote clip editor"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Find the quote</h3>
          <p className="text-xs text-muted-foreground">
            Choose the moment. Keep just the words you want.
          </p>
        </div>
        <a
          className="text-xs text-muted-foreground underline"
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open on YouTube
        </a>
      </div>

      <div
        ref={container}
        className="aspect-video min-h-[200px] w-full bg-black [&_iframe]:h-full [&_iframe]:w-full"
      />
      {!ready && !playerError && (
        <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Loading YouTube player…
        </p>
      )}
      {playerError && (
        <div className="space-y-2 p-4">
          <p role="alert" className="text-sm text-amber-200">
            {playerError} You can still enter times manually.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry player
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="px-4 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={!ready || !valid}
            onClick={() => {
              if (!valid || !player.current) return;
              previewing.current = true;
              setNotice("");
              player.current.seekTo(from, true);
              player.current.playVideo();
            }}
          >
            <Play aria-hidden="true" />
            Preview quote
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!ready || !playing}
            onClick={() => {
              previewing.current = false;
              player.current?.pauseVideo();
            }}
          >
            Pause
          </Button>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(event) => {
                repeatRef.current = event.target.checked;
                setRepeat(event.target.checked);
              }}
              className="accent-primary"
            />
            Repeat
          </label>
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
            {formatClipTime(currentTime)} / {formatClipTime(duration)}
          </span>
        </div>
        {duration > 0 && (
          <label className="block text-xs text-muted-foreground">
            Seek video
            <input
              aria-label="Seek video"
              className="mt-2 w-full accent-primary"
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={Math.min(currentTime, duration)}
              onChange={(event) => {
                const time = Number(event.target.value);
                seek(time, false);
                setWindowStart(
                  Math.max(0, Math.min(time - span / 2, duration - span))
                );
              }}
              onPointerUp={(event) => seek(Number(event.currentTarget.value))}
              onKeyUp={(event) => seek(Number(event.currentTarget.value))}
            />
          </label>
        )}

        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quote timeline
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Earlier on timeline"
                disabled={windowStart <= 0}
                onClick={() =>
                  setWindowStart(Math.max(0, windowStart - span / 2))
                }
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <label className="text-xs">
                Zoom{" "}
                <select
                  aria-label="Timeline zoom"
                  className="h-9 rounded border border-input bg-background px-2 text-base sm:text-xs"
                  value={span}
                  onChange={(event) => setSpan(Number(event.target.value))}
                >
                  <option value={10}>10 sec</option>
                  <option value={30}>30 sec</option>
                  <option value={60}>1 min</option>
                  <option value={120}>2 min</option>
                </select>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Later on timeline"
                disabled={windowEnd >= limit}
                onClick={() =>
                  setWindowStart(
                    Math.min(Math.max(0, limit - span), windowStart + span / 2)
                  )
                }
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div
            className="flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((part) => (
              <span key={part}>
                {formatClipTime(windowStart + windowLength * part)}
              </span>
            ))}
          </div>
          <div
            className="relative mt-2 h-14 touch-none border-y border-border bg-muted/40"
            aria-label="Selection timeline"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && ready)
                seek(timeAt(event));
            }}
          >
            {valid && to > windowStart && from < windowEnd && (
              <div
                className="pointer-events-none absolute inset-y-2 rounded-sm border border-primary/60 bg-primary/20"
                style={{
                  left: `${percent(from)}%`,
                  width: `${percent(to) - percent(from)}%`,
                }}
              />
            )}
            {(["start", "end"] as const).map((edge) => {
              const time = edge === "start" ? from : to;
              if (!valid || time < windowStart || time > windowEnd) return null;
              function move(next: number) {
                const rounded = Math.round(next * 1000) / 1000;
                if (edge === "start")
                  changeRange(
                    Math.min(Math.max(0, rounded), Math.max(0, to - 0.001)),
                    to
                  );
                else
                  changeRange(
                    from,
                    Math.min(limit, Math.max(from + 0.001, rounded))
                  );
              }
              return (
                <button
                  key={edge}
                  type="button"
                  role="slider"
                  aria-label={`Quote ${edge}`}
                  aria-valuemin={edge === "start" ? 0 : from}
                  aria-valuemax={edge === "start" ? to : limit}
                  aria-valuenow={time}
                  aria-valuetext={formatClipTime(time)}
                  className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm border-x-4 border-primary bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  style={{ left: `${percent(time)}%` }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId))
                      return;
                    const bounds =
                      event.currentTarget.parentElement?.getBoundingClientRect();
                    if (!bounds) return;
                    move(
                      windowStart +
                        ((event.clientX - bounds.left) / bounds.width) *
                          windowLength
                    );
                  }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(
                        event.pointerId
                      );
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      move(
                        time +
                          (event.key === "ArrowLeft" ? -1 : 1) *
                            (event.shiftKey ? 1 : 0.1)
                      );
                    }
                  }}
                />
              );
            })}
            {currentTime >= windowStart && currentTime <= windowEnd && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground"
                style={{ left: `${percent(currentTime)}%` }}
              />
            )}
          </div>
          <div
            className="relative mt-2 h-16 touch-none overflow-hidden rounded bg-muted/30"
            aria-label="Transcript timeline"
            onPointerMove={(event) => {
              if (!draggingCue.current || cueAnchor.current === null) return;
              const time = timeAt(event);
              const closest = visibleCues.reduce<{
                index: number;
                distance: number;
              } | null>((best, item) => {
                const distance = Math.max(
                  item.cue.start - time,
                  0,
                  time - item.cue.end
                );
                return !best || distance < best.distance
                  ? { index: item.index, distance }
                  : best;
              }, null);
              if (closest) selectCues(cueAnchor.current, closest.index);
            }}
            onPointerUp={() => {
              draggingCue.current = false;
            }}
            onPointerCancel={() => {
              draggingCue.current = false;
            }}
            onLostPointerCapture={() => {
              draggingCue.current = false;
            }}
          >
            {visibleCues.map(({ cue, index }) => (
              <button
                key={index}
                type="button"
                title={`${formatClipTime(cue.start)} — ${cue.text}`}
                aria-label={`${cue.text}, ${formatClipTime(cue.start)}`}
                aria-pressed={
                  !!selection &&
                  index >= Math.min(selection.anchor, selection.focus) &&
                  index <= Math.max(selection.anchor, selection.focus)
                }
                className={cn(
                  "absolute inset-y-2 overflow-hidden rounded border px-1 text-left text-xs focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  cue.start >= from && cue.end <= to
                    ? "border-primary/70 bg-primary/20 text-foreground"
                    : "border-border bg-secondary text-secondary-foreground"
                )}
                style={{
                  left: `${percent(cue.start)}%`,
                  width: `${Math.max(
                    0.5,
                    percent(cue.end) - percent(cue.start)
                  )}%`,
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  const anchor =
                    event.shiftKey && cueAnchor.current !== null
                      ? cueAnchor.current
                      : index;
                  cueAnchor.current = anchor;
                  draggingCue.current = true;
                  event.currentTarget.parentElement?.setPointerCapture(
                    event.pointerId
                  );
                  if (selectCues(anchor, index))
                    player.current?.seekTo(
                      cues[anchor]?.start ?? cue.start,
                      true
                    );
                }}
                onClick={(event) => {
                  if (event.detail !== 0) return;
                  const anchor =
                    event.shiftKey && cueAnchor.current !== null
                      ? cueAnchor.current
                      : index;
                  cueAnchor.current = anchor;
                  if (selectCues(anchor, index))
                    seek(cues[anchor]?.start ?? cue.start);
                }}
              >
                {cue.text}
              </button>
            ))}
            {visibleCues.length === 0 && (
              <p className="px-3 py-5 text-xs text-muted-foreground">
                {cues.length
                  ? "No words in this part of the video."
                  : "Add subtitles below to select spoken words here."}
              </p>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Drag the red handles to trim. Drag across transcript blocks to
            select a quote. With a keyboard, Shift + Enter extends your
            selection.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={cn(valid && "font-mono tabular-nums")}>
            {valid
              ? `${formatClipTime(from)} → ${formatClipTime(to)} · ${(
                  to - from
                ).toFixed(1)} sec`
              : "Set a start and a later end time below."}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ready || currentTime >= limit}
              onClick={() => {
                const time = Math.round(currentTime * 1000) / 1000;
                changeRange(time, to > time ? to : Math.min(limit, time + 10));
                setWindowStart(Math.max(0, time - 2));
              }}
            >
              Set start here
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ready || currentTime <= from}
              onClick={() =>
                changeRange(
                  from,
                  Math.min(limit, Math.round(currentTime * 1000) / 1000)
                )
              }
            >
              Set end here
            </Button>
          </div>
        </div>
        {start !== null && end !== null && !valid && (
          <p role="alert" className="text-sm text-amber-200">
            The end must be after the start and within this video.
          </p>
        )}
        {selected && (
          <div className="space-y-2 border-l-2 border-primary pl-3">
            <p className="text-sm">“{selected.text}”</p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={
                !selectedMatchesRange ||
                selected.text.length > MAX_QUOTE_TEXT_LENGTH
              }
              onClick={() => onQuoteChange(selected.text)}
            >
              Use selected text as quote
            </Button>
            {!selectedMatchesRange && (
              <p className="text-xs text-muted-foreground">
                Select transcript blocks again to match the adjusted range.
              </p>
            )}
            {selected.text.length > MAX_QUOTE_TEXT_LENGTH && (
              <p className="text-xs text-amber-200">
                {`Select a shorter quote (up to ${MAX_QUOTE_TEXT_LENGTH.toLocaleString(
                  "en-US"
                )} characters).`}
              </p>
            )}
          </div>
        )}

        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            {cues.length
              ? `Subtitles loaded · ${cues.length} timed blocks`
              : "Add a transcript (optional)"}
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Use an SRT or WebVTT subtitle file from this exact clip. Each
              block keeps its supplied timing: words when available, phrases
              otherwise. The transcript stays in this editor; only your quote
              and times are saved.
            </p>
            <label className="block text-sm">
              Subtitle file
              <input
                type="file"
                accept=".srt,.vtt,text/vtt"
                className="mt-2 block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  const generation = ++fileGeneration.current;
                  if (!file) return;
                  if (file.size > MAX_CAPTION_BYTES) {
                    setCaptionError("Use a subtitle file smaller than 500 KB.");
                    return;
                  }
                  void file
                    .text()
                    .then((text) => {
                      if (generation === fileGeneration.current) {
                        setTranscriptInput(text);
                        importCaptions(text);
                      }
                    })
                    .catch(() => {
                      if (generation === fileGeneration.current)
                        setCaptionError(
                          "Could not read that file. Try pasting the subtitles."
                        );
                    });
                }}
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span>Or paste timed subtitles</span>
              <Textarea
                aria-label="Timed subtitles"
                rows={4}
                maxLength={MAX_CAPTION_BYTES}
                value={transcriptInput}
                onChange={(event) => {
                  fileGeneration.current += 1;
                  setTranscriptInput(event.target.value);
                }}
                placeholder={
                  "WEBVTT\n\n00:00:12.000 --> 00:00:14.500\nThe quote goes here."
                }
                className="font-mono text-base sm:text-xs"
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!transcriptInput.trim()}
              onClick={() => importCaptions(transcriptInput)}
            >
              Load transcript
            </Button>
            {captionError && (
              <p role="alert" className="text-sm text-amber-200">
                {captionError}
              </p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
