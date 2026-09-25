"use client";

import { useQuery } from "convex/react";
import {
  Component,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  type LatestPointChange,
  latestPointChangeReference,
  summarizeLatestPointChange,
} from "@/convex/pointChange";
import { getPacificTodayPlainDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

// Kept per member, so people sharing a browser don't hide each other's badge.
function seenStorageKey(userId: string): string {
  return `bbpc.seenPointChange:${userId}`;
}

function readSeen(userId: string | null): string | null {
  if (userId === null) {
    return null;
  }
  try {
    return window.localStorage.getItem(seenStorageKey(userId));
  } catch {
    return null;
  }
}

function writeSeen(userId: string | null, key: string) {
  if (userId === null) {
    return;
  }
  try {
    window.localStorage.setItem(seenStorageKey(userId), key);
  } catch {
    // The badge still clears for this page view.
  }
}

// The header stays mounted across navigation, so refresh the date when the tab
// comes back into view rather than keeping the date it first loaded with.
function usePacificToday(): string {
  const [today, setToday] = useState(getPacificTodayPlainDate);
  useEffect(() => {
    const refresh = () => setToday(getPacificTodayPlainDate());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return today;
}

function LatestPointChangeQuery({
  onChange,
  today,
}: {
  onChange: (change: LatestPointChange | null) => void;
  today: string;
}) {
  const result: unknown = useQuery(latestPointChangeReference, { today });
  const summary = useMemo(
    () =>
      result === undefined ? undefined : summarizeLatestPointChange(result),
    [result]
  );
  useEffect(() => {
    if (summary !== undefined) {
      onChange(summary);
    }
  }, [onChange, summary]);
  return null;
}

// A badge failure (for example, a backend without this query yet) must never
// take down the header around it.
class PointChangeErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Loads the member's point change from the last episode. Render `loader`
 * somewhere in the tree; `latest` stays null until the query answers.
 */
export function useLatestPointChange(enabled: boolean): {
  latest: LatestPointChange | null;
  loader: ReactNode;
} {
  const [latest, setLatest] = useState<LatestPointChange | null>(null);
  const today = usePacificToday();
  useEffect(() => {
    if (!enabled) {
      setLatest(null);
    }
  }, [enabled]);
  // Keyed by date so a failed query gets another try the next day.
  const loader = enabled ? (
    <PointChangeErrorBoundary key={today}>
      <LatestPointChangeQuery onChange={setLatest} today={today} />
    </PointChangeErrorBoundary>
  ) : null;
  return { latest: enabled ? latest : null, loader };
}

/**
 * Returns the member's unseen point change from the last episode, or null.
 * Visiting the game page marks the current change as seen.
 */
export function useUnseenPointChange(
  enabled: boolean,
  onGamePage: boolean,
  userId: string | null
): { change: number | null; loader: ReactNode } {
  const { latest, loader } = useLatestPointChange(enabled);
  const [seen, setSeen] = useState<string | null>(null);

  useEffect(() => {
    setSeen(readSeen(userId));
  }, [userId]);
  useEffect(() => {
    if (onGamePage && latest !== null && latest.key !== seen) {
      writeSeen(userId, latest.key);
      setSeen(latest.key);
    }
  }, [latest, onGamePage, seen, userId]);

  const change =
    !onGamePage && latest !== null && latest.change !== 0 && latest.key !== seen
      ? latest.change
      : null;
  return { change, loader };
}

export function formatPointChange(change: number): string {
  return change > 0 ? `+${change}` : `${change}`;
}

export function PointChangeBadge({
  change,
  className,
}: {
  change: number;
  className?: string;
}) {
  const points = Math.abs(change) === 1 ? "point" : "points";
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums",
        // Gains green, losses amber, so red stays the site accent.
        change > 0
          ? "bg-emerald-600 text-white"
          : change < 0
          ? "bg-amber-400 text-zinc-900"
          : "bg-zinc-700 text-zinc-100",
        className
      )}
    >
      <span aria-hidden="true">{formatPointChange(change)}</span>
      <span className="sr-only">
        {`, ${formatPointChange(change)} ${points} last episode`}
      </span>
    </span>
  );
}
