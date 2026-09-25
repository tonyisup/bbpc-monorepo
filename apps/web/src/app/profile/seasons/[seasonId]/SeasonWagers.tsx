"use client";

import Link from "next/link";

import { MoviePoster } from "@/components/MoviePoster";
import type { ConvexSeasonWager } from "@/convex/seasons";
import { getEpisodePath } from "@/lib/routes";
import {
  type SeasonWagerSummary,
  WAGER_STATUS_LABELS,
  formatSignedPoints,
  formatWagerRecord,
  signedPointsClass,
} from "@/lib/seasonActivity";

const statusClass: Record<ConvexSeasonWager["status"], string> = {
  won: "bg-emerald-500/15 text-emerald-300",
  lost: "bg-red-500/15 text-red-300",
  locked: "bg-amber-500/15 text-amber-300",
  pending: "bg-zinc-500/20 text-zinc-200",
  rejected: "bg-zinc-500/20 text-zinc-400",
};

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-xs font-bold uppercase tracking-[0.08em] text-zinc-400">
        {label}
      </dt>
      <dd className="font-bold text-white">{value}</dd>
    </div>
  );
}

function EpisodeCell({ wager }: { wager: ConvexSeasonWager }) {
  const episode = wager.assignment?.episode ?? null;
  if (episode === null) {
    return <span className="text-zinc-500">—</span>;
  }
  const label = `Ep ${episode.number}`;
  return episode.slug === null ? (
    <span className="font-semibold text-white">{label}</span>
  ) : (
    <Link
      href={getEpisodePath(episode.slug)}
      className="font-semibold text-white transition-colors hover:text-red-300"
    >
      {label}
    </Link>
  );
}

export function SeasonWagers({
  wagers,
  summary,
}: {
  wagers: ConvexSeasonWager[];
  summary: SeasonWagerSummary;
}) {
  if (wagers.length === 0) {
    return <p className="text-sm text-zinc-400">No wagers this season.</p>;
  }
  return (
    <div className="space-y-4">
      <dl className="bbpc-panel flex flex-wrap gap-x-8 gap-y-2 px-5 py-4 text-sm">
        <SummaryItem label="Record" value={formatWagerRecord(summary)} />
        <SummaryItem label="Net" value={formatSignedPoints(summary.net)} />
        <SummaryItem label="Open wagers" value={`${summary.open}`} />
        <SummaryItem label="Staked" value={`${summary.staked} pts`} />
      </dl>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm" aria-label="Season wagers">
          <thead className="border-b border-white/10 text-xs uppercase tracking-[0.2em] text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Episode</th>
              <th className="px-4 py-3 font-semibold">Movie</th>
              <th className="px-4 py-3 font-semibold">Wager</th>
              <th className="px-4 py-3 font-semibold">Stake</th>
              <th className="px-4 py-3 font-semibold">Result</th>
              <th className="px-4 py-3 font-semibold">Payout</th>
            </tr>
          </thead>
          <tbody>
            {wagers.map((wager) => (
              <tr
                key={wager.id}
                className="border-b border-white/[0.06] last:border-b-0"
              >
                <td className="px-4 py-3">
                  <EpisodeCell wager={wager} />
                </td>
                <td className="px-4 py-3 text-zinc-200">
                  {wager.assignment === null ? (
                    "—"
                  ) : (
                    <span className="flex items-center gap-3">
                      <MoviePoster
                        poster={wager.assignment.movie.poster}
                        className="h-12 w-8"
                      />
                      <span>
                        {wager.assignment.movie.title} (
                        {wager.assignment.movie.year})
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-200">
                  {wager.gamblingType.title} ×{wager.gamblingType.multiplier}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-200">
                  {wager.points} pts
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass[wager.status]}`}
                  >
                    {WAGER_STATUS_LABELS[wager.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {wager.awardPoint === null ? (
                    <span className="text-zinc-500">—</span>
                  ) : (
                    <span
                      className={`font-bold tabular-nums ${signedPointsClass(
                        wager.awardPoint.total
                      )}`}
                    >
                      {formatSignedPoints(wager.awardPoint.total)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
