export interface YouTubePlayer {
  destroy(): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
}

export interface YouTubeAPI {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: { origin: string; playsinline: number; start: number };
      events: {
        onReady: () => void;
        onError: (event: { data: number }) => void;
        onAutoplayBlocked: () => void;
      };
    }
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeAPI;
  }
}

let pending: Promise<YouTubeAPI> | undefined;

/** Share the script without taking over other players' global ready callbacks. */
export function loadYouTubeAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YouTubeAPI>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    const script = existing ?? document.createElement("script");
    const finish = (error?: Error) => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      script.removeEventListener("error", fail);
      if (error) {
        if (!existing) script.remove();
        reject(error);
      } else if (window.YT) resolve(window.YT);
    };
    const fail = () =>
      finish(
        new Error("YouTube could not load. Check your connection or try again.")
      );
    const interval = window.setInterval(() => {
      if (window.YT?.Player) finish();
    }, 100);
    const timeout = window.setTimeout(fail, 15_000);
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
