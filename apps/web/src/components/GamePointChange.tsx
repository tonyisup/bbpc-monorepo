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

const SEEN_STORAGE_KEY = "bbpc.seenPointChange";

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSeen(key: string) {
  try {
    window.localStorage.setItem(SEEN_STORAGE_KEY, key);
  } catch {
    // The badge still clears for this page view.
  }
}

function LatestPointChangeQuery({
  onChange,
}: {
  onChange: (change: LatestPointChange | null) => void;
}) {
  const [today] = useState(getPacificTodayPlainDate);
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
  useEffect(() => {
    if (!enabled) {
      setLatest(null);
    }
  }, [enabled]);
  const loader = enabled ? (
    <PointChangeErrorBoundary>
      <LatestPointChangeQuery onChange={setLatest} />
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
  onGamePage: boolean
): { change: number | null; loader: ReactNode } {
  const { latest, loader } = useLatestPointChange(enabled);
  const [seen, setSeen] = useState<string | null>(null);

  useEffect(() => {
    setSeen(readSeen());
  }, []);
  useEffect(() => {
    if (onGamePage && latest !== null && latest.key !== seen) {
      writeSeen(latest.key);
      setSeen(latest.key);
    }
  }, [latest, onGamePage, seen]);

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
        change > 0 ? "bg-red-500 text-white" : "bg-zinc-700 text-zinc-100",
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
