import { parseYouTubeUrl, youtubeWatchUrl } from "@bbpc/youtube";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";
import { formatClipTime } from "@/lib/clipTimes";
import { useYouTubePlayer } from "@/lib/useYouTubePlayer";

import { Button } from "../ui/button";

interface QuoteClipPlayerProps {
  videoId: string;
  start: number;
  /** Where the clip stops; null plays on from the start. */
  end: number | null;
  onClose: () => void;
}

/** A clip's range as the recording panel labels it. */
export function clipRangeLabel(start: number, end: number | null): string {
  return end === null
    ? `from ${formatClipTime(start)}`
    : `${formatClipTime(start)}–${formatClipTime(end)}`;
}

/**
 * Plays only the marked part of a YouTube video, starting as soon as the
 * player loads and pausing at the marked end.
 */
export function QuoteClipPlayer({
  videoId,
  start,
  end,
  onClose,
}: QuoteClipPlayerProps) {
  const player = useYouTubePlayer(videoId, start);
  const { ready, error, currentTime, duration, playing, autoplayBlocked } =
    player.state;
  const { playUntil, togglePlay } = player;
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    playUntil(start, end);
  }, [end, playUntil, ready, start]);

  // A video that has itself ended counts as a finished clip, even when the
  // clip has no end or runs past the video.
  const videoEnded = duration > 0 && currentTime >= duration - 0.25;
  const insideClip =
    !videoEnded && currentTime >= start && (end === null || currentTime < end);
  const playOrPause = () => {
    if (playing) togglePlay();
    // A paused clip resumes where it stopped; a finished one starts again.
    else playUntil(insideClip ? currentTime : start, end);
  };
  const progress =
    end === null
      ? null
      : Math.min(1, Math.max(0, (currentTime - start) / (end - start)));

  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <div
          className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full"
          ref={player.container}
        />
      </div>
      {progress !== null && (
        <div
          aria-hidden="true"
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary"
            style={{ width: `${String(progress * 100)}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready} onClick={playOrPause} size="sm" type="button">
          {playing ? (
            <Pause className="mr-1 h-4 w-4" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          {playing ? "Pause" : "Play clip"}
        </Button>
        <Button
          disabled={!ready}
          onClick={() => playUntil(start, end)}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Replay
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatClipTime(currentTime)} · clip {clipRangeLabel(start, end)}
        </span>
        <Button
          className="ml-auto"
          onClick={onClose}
          size="sm"
          type="button"
          variant="ghost"
        >
          <X className="mr-1 h-4 w-4" /> Close
        </Button>
      </div>
      {!ready && error.length === 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          Loading the clip…
        </p>
      )}
      {autoplayBlocked && !playing && (
        <p className="text-sm text-muted-foreground" role="status">
          The browser held the clip back. Press Play clip to start it.
        </p>
      )}
      {error.length > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-300" role="alert">
          {error}{" "}
          <a
            className="font-semibold underline"
            href={youtubeWatchUrl(videoId, start)}
            rel="noreferrer noopener"
            target="_blank"
          >
            Open it on YouTube
          </a>
        </p>
      )}
    </div>
  );
}

/**
 * An entry's YouTube clip, played in place: a button while closed, and the
 * player on a line of its own inside a wrapping row once opened. Entries
 * without a YouTube link render nothing.
 */
export function InlineQuoteClip({
  submission,
  open,
  onOpenChange,
}: {
  submission: ConvexAdminQuoteSubmission;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const video =
    submission.clipUrl === null ? null : parseYouTubeUrl(submission.clipUrl);
  if (video === null) return null;
  // A clip saved without a start opens where its link does.
  const start = submission.clipStartSeconds ?? video.start;
  const end = submission.clipEndSeconds;
  if (!open) {
    return (
      <Button onClick={() => onOpenChange(true)} size="sm" type="button">
        <Play className="mr-1 h-4 w-4" /> Play clip {clipRangeLabel(start, end)}
      </Button>
    );
  }
  return (
    <div className="order-last w-full basis-full">
      <QuoteClipPlayer
        end={end}
        onClose={() => onOpenChange(false)}
        start={start}
        videoId={video.id}
      />
    </div>
  );
}
