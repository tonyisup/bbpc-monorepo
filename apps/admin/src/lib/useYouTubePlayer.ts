import { loadYouTubeAPI, type YouTubePlayer } from "@bbpc/youtube";
import { useCallback, useEffect, useRef, useState } from "react";

const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;
const BUFFERING = 3;
const CUED = 5;
const READY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 100;
// A seek settles asynchronously: until then the player may still report the
// time, or ENDED, from before it. It counts as landed once the reported time is
// within this of the target, or at least halfway there from where it was (a
// seek into unbuffered video lands on the keyframe before the target).
// Playback can carry the time past the target before the next poll, which
// counts too unless the seek went backward, where the old time lies that way.
const SEEK_NEAR_SECONDS = 0.15;
// A seek that never lands is given up after this many polls, not counting
// polls spent buffering.
const SEEK_SETTLE_POLLS = 20;

export interface YouTubePlayerState {
  ready: boolean;
  error: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  /** The browser refused to start playback until the viewer presses play. */
  autoplayBlocked: boolean;
}

function sameState(left: YouTubePlayerState, right: YouTubePlayerState) {
  return (Object.keys(left) as (keyof YouTubePlayerState)[]).every(
    (key) => left[key] === right[key]
  );
}

function playerErrorMessage(code: number): string {
  if (code === 101 || code === 150) {
    return "The owner doesn't allow this video to play here.";
  }
  if (code === 100) {
    return "This video is private or was removed.";
  }
  return "YouTube couldn't play this video.";
}

/**
 * One YouTube player in `container`, reloaded when the video changes. The
 * time is polled every POLL_INTERVAL_MS, and `playUntil` pauses at a chosen
 * second.
 */
export function useYouTubePlayer(videoId: string, startAt: number) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const stopAt = useRef<number | null>(null);
  const pendingSeek = useRef<{
    target: number;
    from: number;
    polls: number;
  } | null>(null);
  const blocked = useRef(false);
  const startRef = useRef(startAt);
  startRef.current = startAt;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<YouTubePlayerState>({
    ready: false,
    error: "",
    currentTime: startAt,
    duration: 0,
    playing: false,
    autoplayBlocked: false,
  });

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let readyTimeout: number | undefined;
    let instance: YouTubePlayer | null = null;
    // A video YouTube refused stays refused, even if onReady follows onError.
    let refused = false;
    const host = container.current;
    // An error can arrive after the player is ready (an embed refusal often
    // does), so polling stops too, or its next tick would clear the error.
    const fail = (error: string) => {
      if (disposed) return;
      window.clearTimeout(readyTimeout);
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      player.current = null;
      stopAt.current = null;
      pendingSeek.current = null;
      setState((current) => ({ ...current, ready: false, error }));
    };
    stopAt.current = null;
    pendingSeek.current = null;
    blocked.current = false;
    setState({
      ready: false,
      error: "",
      currentTime: startRef.current,
      duration: 0,
      playing: false,
      autoplayBlocked: false,
    });
    void loadYouTubeAPI()
      .then((api) => {
        if (disposed || !host) return;
        const mount = document.createElement("div");
        host.appendChild(mount);
        readyTimeout = window.setTimeout(
          () => fail("YouTube is taking too long to respond."),
          READY_TIMEOUT_MS
        );
        instance = new api.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            origin: window.location.origin,
            playsinline: 1,
            start: Math.floor(startRef.current),
          },
          events: {
            onReady: () => {
              if (disposed || refused || !instance) return;
              window.clearTimeout(readyTimeout);
              player.current = instance;
              const poll = () => {
                if (disposed || !instance) return;
                const time = instance.getCurrentTime();
                const length = instance.getDuration();
                const status = instance.getPlayerState();
                const seeking = pendingSeek.current;
                if (seeking !== null) {
                  if (status !== BUFFERING) seeking.polls += 1;
                  const landedWithin = Math.max(
                    SEEK_NEAR_SECONDS,
                    Math.abs(seeking.from - seeking.target) / 2
                  );
                  const offset = time - seeking.target;
                  const backward =
                    seeking.from - seeking.target >= landedWithin;
                  if (
                    (status !== ENDED &&
                      offset > -landedWithin &&
                      (!backward || offset < landedWithin)) ||
                    seeking.polls >= SEEK_SETTLE_POLLS
                  ) {
                    pendingSeek.current = null;
                  }
                }
                // The stop waits for the seek, or a replay from past the end
                // would be paused by the time it is leaving.
                if (
                  pendingSeek.current === null &&
                  stopAt.current !== null &&
                  (time >= stopAt.current || status === ENDED)
                ) {
                  stopAt.current = null;
                  instance.pauseVideo();
                }
                if (status === PLAYING) blocked.current = false;
                const next = {
                  ready: true,
                  error: "",
                  currentTime:
                    pendingSeek.current?.target ??
                    (Number.isFinite(time) ? time : 0),
                  duration: Number.isFinite(length) ? length : 0,
                  playing: status === PLAYING,
                  autoplayBlocked: blocked.current,
                };
                // A paused player reports the same state every tick; keeping
                // the old object skips the re-render.
                setState((current) =>
                  sameState(current, next) ? current : next
                );
              };
              poll();
              timer = window.setInterval(poll, POLL_INTERVAL_MS);
            },
            onError: ({ data }) => {
              refused = true;
              fail(playerErrorMessage(data));
            },
            onAutoplayBlocked: () => {
              blocked.current = true;
            },
          },
        });
      })
      .catch((error: unknown) => {
        fail(error instanceof Error ? error.message : "YouTube couldn't load.");
      });
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearInterval(timer);
      window.clearTimeout(readyTimeout);
      player.current = null;
      instance?.destroy();
      host?.replaceChildren();
    };
  }, [videoId, retry]);

  const seek = useCallback((seconds: number) => {
    const current = player.current;
    if (!current) return;
    const length = current.getDuration();
    const limit = Number.isFinite(length) && length > 0 ? length : seconds;
    const time = Math.min(Math.max(0, seconds), limit);
    stopAt.current = null;
    pendingSeek.current = {
      target: time,
      from: current.getCurrentTime(),
      polls: 0,
    };
    const status = current.getPlayerState();
    current.seekTo(time, true);
    // seekTo starts a cued, unstarted or finished video; a seek alone must
    // not, or opening an entry would start it playing.
    if (status === UNSTARTED || status === CUED || status === ENDED) {
      current.pauseVideo();
    }
    setState((state) => ({ ...state, currentTime: time }));
  }, []);

  const togglePlay = useCallback(() => {
    const current = player.current;
    if (!current) return;
    stopAt.current = null;
    if (current.getPlayerState() === PLAYING) current.pauseVideo();
    else current.playVideo();
  }, []);

  /** Play from `from`, pausing at `until`, or running on when it is null. */
  const playUntil = useCallback((from: number, until: number | null) => {
    const current = player.current;
    if (!current) return;
    const target = Math.max(0, from);
    pendingSeek.current = {
      target,
      from: current.getCurrentTime(),
      polls: 0,
    };
    current.seekTo(target, true);
    stopAt.current = until;
    current.playVideo();
  }, []);

  const setRate = useCallback((rate: number) => {
    player.current?.setPlaybackRate(rate);
  }, []);

  // Mid-seek the player may still report where it was, so steps taken in a
  // row, and marks set right after one, count from the target instead.
  const currentTime = useCallback(
    () =>
      pendingSeek.current?.target ??
      player.current?.getCurrentTime() ??
      state.currentTime,
    [state.currentTime]
  );

  return {
    container,
    state,
    seek,
    togglePlay,
    playUntil,
    setRate,
    currentTime,
    retry: () => setRetry((value) => value + 1),
  };
}
