import { GamepadIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ConvexSeasonInfo, ConvexSeasonStanding } from "@/convex/seasons";
import { formatPlainDate } from "@/lib/dates";
import { ordinal } from "@/lib/seasonActivity";

/** The one-tap route from a season summary into the current round. */
export function PlayGameLink() {
  return (
    <Button asChild size="sm">
      <Link href="/game">
        <GamepadIcon aria-hidden="true" />
        Go play
      </Link>
    </Button>
  );
}

export function CurrentSeasonBadge() {
  return (
    <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-white">
      Current
    </span>
  );
}

export function SeasonStatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 py-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-400">
        {label}
      </span>
      <span className="text-2xl font-bold leading-tight text-white">
        {value}
      </span>
      {detail !== undefined && (
        <span className="text-xs text-zinc-400">{detail}</span>
      )}
    </div>
  );
}

const shortDate = { month: "short", day: "numeric" } as const;

/** "Aug 4, 2026 – " for a running season, "Jun 2 – Jul 28, 2026" once ended. */
export function formatSeasonDates(season: ConvexSeasonInfo): string {
  if (season.startedOn === null) {
    return season.endedOn === null
      ? "Undated"
      : `Ended ${formatPlainDate(season.endedOn)}`;
  }
  if (season.endedOn === null) {
    return `Started ${formatPlainDate(season.startedOn)}`;
  }
  return `${formatPlainDate(season.startedOn, shortDate)} – ${formatPlainDate(
    season.endedOn
  )}`;
}

export function formatEpisodeCount(count: number | null): string | null {
  if (count === null) {
    return null;
  }
  return count === 1 ? "1 episode" : `${count} episodes`;
}

export function pointsLabel(count: number): string {
  return `${count} ${count === 1 ? "point" : "points"}`;
}

/** What the Available tile says under its number. */
export function formatStakedDetail(staked: number): string {
  return staked > 0 ? `${staked} in open wagers` : "Nothing wagered";
}

export function formatStanding(standing: ConvexSeasonStanding): string {
  return standing === null ? "—" : ordinal(standing.rank);
}

export function formatStandingDetail(standing: ConvexSeasonStanding): string {
  if (standing === null) {
    return "No points yet";
  }
  return standing.playerCount === 1
    ? "the only scorer"
    : `of ${standing.playerCount} players`;
}
