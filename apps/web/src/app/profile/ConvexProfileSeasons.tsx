"use client";

import { useConvex } from "convex/react";
import { ArrowRight, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useLatestPointChange } from "@/components/GamePointChange";
import { SeasonProgress } from "@/components/SeasonProgress";
import {
  CurrentSeasonBadge,
  SeasonStatTile,
  formatEpisodeCount,
  formatSeasonDates,
  formatStanding,
  formatStandingDetail,
} from "@/components/SeasonSummary";
import { type ConvexSeasonSummary, loadConvexSeasons } from "@/convex/seasons";
import { getPacificTodayPlainDate } from "@/lib/dates";
import { getProfileSeasonPath } from "@/lib/routes";
import { formatSignedPoints } from "@/lib/seasonActivity";

const viewSeasonClass =
  "inline-flex items-center gap-1.5 text-sm font-semibold text-red-300";

function pointsLabel(count: number): string {
  return `${count} ${count === 1 ? "point" : "points"}`;
}

export function ConvexProfileSeasons({ appUserId }: { appUserId: string }) {
  const convex = useConvex();
  const [seasons, setSeasons] = useState<ConvexSeasonSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loadGenerationRef = useRef(0);
  const pointChange = useLatestPointChange(true);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setSeasons(null);
    setFailed(false);

    void loadConvexSeasons(convex, getPacificTodayPlainDate())
      .then((result) => {
        if (loadGenerationRef.current === generation) {
          setSeasons(result);
        }
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) {
          setFailed(true);
        }
      });
  }, [appUserId, convex]);

  return (
    <section
      className="w-full max-w-4xl space-y-4"
      aria-labelledby="profile-seasons-heading"
    >
      <h2
        id="profile-seasons-heading"
        className="text-xl font-bold tracking-tight"
      >
        Seasons
      </h2>
      {pointChange.loader}
      {failed ? (
        <p className="text-sm text-red-300" role="alert">
          Your seasons could not be loaded.
        </p>
      ) : seasons === null ? (
        <div
          className="h-40 w-full animate-pulse rounded-lg bg-white/[0.04]"
          aria-label="Loading seasons"
        />
      ) : seasons.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No season is running right now. Your seasons show up here once you
          start scoring.
        </p>
      ) : (
        <div className="space-y-3">
          {seasons.map((entry) =>
            entry.isCurrent ? (
              <CurrentSeasonCard
                key={entry.season.id}
                summary={entry}
                lastEpisodeChange={pointChange.latest?.change ?? null}
              />
            ) : (
              <PastSeasonRow key={entry.season.id} summary={entry} />
            )
          )}
        </div>
      )}
    </section>
  );
}

function CurrentSeasonCard({
  summary,
  lastEpisodeChange,
}: {
  summary: ConvexSeasonSummary;
  lastEpisodeChange: number | null;
}) {
  const { season } = summary;
  const available = summary.available ?? 0;
  const staked = summary.total - available;
  const progress =
    season.episodeCount !== null && summary.recordedEpisodeCount !== null
      ? { recorded: summary.recordedEpisodeCount, total: season.episodeCount }
      : null;

  return (
    <article className="bbpc-panel overflow-hidden border-red-500/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-5 py-4">
        <div className="flex items-center gap-3">
          <Trophy className="h-5 w-5 text-yellow-500" aria-hidden="true" />
          <h3 className="text-xl font-bold text-white">{season.title}</h3>
          <CurrentSeasonBadge />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-zinc-400">{formatSeasonDates(season)}</span>
          <Link
            href={getProfileSeasonPath(season.id)}
            className={viewSeasonClass}
          >
            View season
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SeasonStatTile
            label="Total earned"
            value={summary.total}
            detail={pointsLabel(summary.pointCount)}
          />
          <SeasonStatTile
            label="Available"
            value={available}
            detail={
              staked > 0 ? `${staked} in open wagers` : "Nothing wagered"
            }
          />
          <SeasonStatTile
            label="Last episode"
            value={
              lastEpisodeChange === null ? (
                "—"
              ) : (
                <span
                  className={
                    lastEpisodeChange < 0 ? "text-red-400" : "text-emerald-400"
                  }
                >
                  {formatSignedPoints(lastEpisodeChange)}
                </span>
              )
            }
            detail="Latest scoring day"
          />
          <SeasonStatTile
            label="Standing"
            value={formatStanding(summary.standing)}
            detail={formatStandingDetail(summary.standing)}
          />
        </div>
        {progress !== null && <SeasonProgress progress={progress} />}
      </div>
    </article>
  );
}

function PastSeasonRow({ summary }: { summary: ConvexSeasonSummary }) {
  const { season } = summary;
  const episodes = formatEpisodeCount(season.episodeCount);
  return (
    <Link
      href={getProfileSeasonPath(season.id)}
      className="bbpc-panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      <span className="flex flex-wrap items-center gap-3">
        <Trophy className="h-5 w-5 text-zinc-500" aria-hidden="true" />
        <span className="text-lg font-bold text-white">{season.title}</span>
        <span className="text-sm text-zinc-400">
          {formatSeasonDates(season)}
          {episodes === null ? "" : ` · ${episodes}`}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-6 text-sm">
        <span>
          <span className="text-zinc-400">Final </span>
          <strong className="text-lg text-white">{summary.total}</strong>
        </span>
        <span>
          <span className="text-zinc-400">Points </span>
          <strong className="text-white">{summary.pointCount}</strong>
        </span>
        <span className={viewSeasonClass}>
          View season
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
