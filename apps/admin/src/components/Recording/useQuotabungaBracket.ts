import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import {
  type BracketEvent,
  type BracketView,
  bracketEventSchema,
  deriveBracket,
} from "./quotabungaBracketModel";

// Version 2 names each matchup vote's matchup and the judges at the start.
const STORAGE_VERSION = 2;

const storedBracketSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  events: z.array(bracketEventSchema),
});

const storageKey = (episodeId: string) =>
  `bbpc-admin:quotabunga-bracket:${episodeId}`;

/**
 * The saved bracket, or null when the browser can't read it. A saved bracket
 * that doesn't parse or doesn't replay into a bracket is dropped, so the
 * round starts over instead of being stuck behind it.
 */
function readStoredOrNull(episodeId: string): BracketEvent[] | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey(episodeId));
  } catch {
    return null;
  }
  if (raw === null) return [];
  try {
    const parsed = storedBracketSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return deriveBracket(parsed.data.events) === null ? [] : parsed.data.events;
  } catch {
    return [];
  }
}

const readStored = (episodeId: string) => readStoredOrNull(episodeId) ?? [];

/** Whether the browser kept the bracket. */
function writeStored(episodeId: string, events: BracketEvent[]): boolean {
  try {
    if (events.length === 0) {
      window.localStorage.removeItem(storageKey(episodeId));
    } else {
      window.localStorage.setItem(
        storageKey(episodeId),
        JSON.stringify({ version: STORAGE_VERSION, events })
      );
    }
    return true;
  } catch {
    // Without storage the bracket still runs; it just won't survive a reload.
    return false;
  }
}

interface BracketLog {
  episodeId: string;
  events: BracketEvent[];
}

const sameEvents = (left: BracketEvent[], right: BracketEvent[]) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * A round's bracket, kept in this browser so a reload during the recording
 * picks up where it left off. Tabs of this browser share it: a tab shows
 * another tab's changes when they're saved, and a tap made on a tab that is
 * behind isn't counted. That tab shows the newer bracket and says so instead,
 * since what the tap meant may no longer be on screen. The bracket is stale
 * once the round's included entries differ from the ones it started with.
 */
export function useQuotabungaBracket(
  episodeId: string,
  includedIds: readonly string[]
) {
  // The log names its round, so another round never shows its events, even
  // for the render before its own stored events load. The ref holds the same
  // log for changes made between renders.
  const [log, setLog] = useState<BracketLog | null>(null);
  const logRef = useRef<BracketLog | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveFailedRef = useRef(false);
  const [conflict, setConflict] = useState(false);
  const show = useCallback((next: BracketLog) => {
    logRef.current = next;
    setLog(next);
  }, []);
  const failSaving = useCallback((failed: boolean) => {
    saveFailedRef.current = failed;
    setSaveFailed(failed);
  }, []);

  useEffect(() => {
    show({ episodeId, events: readStored(episodeId) });
    failSaving(false);
    setConflict(false);
  }, [episodeId, failSaving, show]);
  useEffect(() => {
    const reload = (event: StorageEvent) => {
      // A tab that couldn't save keeps its own votes rather than lose them.
      if (saveFailedRef.current) return;
      // A null key means another tab cleared this browser's storage.
      if (event.key === null || event.key === storageKey(episodeId)) {
        show({ episodeId, events: readStored(episodeId) });
      }
    };
    try {
      window.addEventListener("storage", reload);
    } catch {
      return undefined;
    }
    return () => window.removeEventListener("storage", reload);
  }, [episodeId, show]);
  const events = useMemo(
    () => (log?.episodeId === episodeId ? log.events : []),
    [episodeId, log]
  );

  const update = useCallback(
    (change: (events: BracketEvent[]) => BracketEvent[]) => {
      const current = logRef.current;
      const mine = current?.episodeId === episodeId ? current.events : [];
      // Once saving has failed the saved bracket is behind this tab, so it
      // isn't compared.
      const stored = saveFailedRef.current ? null : readStoredOrNull(episodeId);
      if (stored !== null && !sameEvents(stored, mine)) {
        show({ episodeId, events: stored });
        setConflict(true);
        return;
      }
      const next = change(mine);
      if (next === mine) return;
      // Saved at once, so another tab's next tap already sees it.
      failSaving(!writeStored(episodeId, next));
      show({ episodeId, events: next });
      setConflict(false);
    },
    [episodeId, failSaving, show]
  );
  // An event that changes nothing isn't kept, so Undo always takes back
  // something visible.
  const dispatch = useCallback(
    (event: BracketEvent) =>
      update((current) => {
        const next = [...current, event];
        return JSON.stringify(deriveBracket(next)) ===
          JSON.stringify(deriveBracket(current))
          ? current
          : next;
      }),
    [update]
  );
  const undo = useCallback(
    () => update((current) => current.slice(0, -1)),
    [update]
  );
  const reset = useCallback(() => update(() => []), [update]);

  const view: BracketView | null = useMemo(
    () => deriveBracket(events),
    [events]
  );
  const included = includedIds.join("\n");
  const stale = useMemo(() => {
    if (view === null) return false;
    const current = new Set(included === "" ? [] : included.split("\n"));
    return (
      current.size !== view.entryIds.length ||
      view.entryIds.some((id) => !current.has(id))
    );
  }, [included, view]);

  const loaded = log?.episodeId === episodeId;
  return { view, stale, loaded, saveFailed, conflict, dispatch, undo, reset };
}
