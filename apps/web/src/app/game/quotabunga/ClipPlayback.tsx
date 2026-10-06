"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ClipPlayback {
  /** The key of the one clip playing on the page, if any. */
  playingKey: string | null;
  toggle: (key: string) => void;
  stop: () => void;
}

const ClipPlaybackContext = createContext<ClipPlayback | null>(null);

function useClipPlaybackState(): ClipPlayback {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const toggle = useCallback(
    (key: string) =>
      setPlayingKey((current) => (current === key ? null : key)),
    []
  );
  const stop = useCallback(() => setPlayingKey(null), []);
  return useMemo(
    () => ({ playingKey, toggle, stop }),
    [playingKey, toggle, stop]
  );
}

/** One clip at a time for everything inside: starting one stops the other. */
export function ClipPlaybackProvider({ children }: { children: ReactNode }) {
  return (
    <ClipPlaybackContext.Provider value={useClipPlaybackState()}>
      {children}
    </ClipPlaybackContext.Provider>
  );
}

/**
 * The page's shared clip playback. A component rendered outside a provider
 * keeps its own, so it still works on its own.
 */
export function useClipPlayback(): ClipPlayback {
  const shared = useContext(ClipPlaybackContext);
  const own = useClipPlaybackState();
  return shared ?? own;
}
