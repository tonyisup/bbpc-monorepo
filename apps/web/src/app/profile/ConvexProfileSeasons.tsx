"use client";

import { useConvex } from "convex/react";
import { ArrowRight, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useLatestPointChange } from "@/components/GamePointChange";
import { SeasonProgress } from "@/components/SeasonProgress";
import {
  CurrentSeasonBadge,
  PlayGameLink,
  SeasonStatTile,
  formatEpisodeCount,
  formatSeasonDates,
  formatStanding,
  formatStandingDetail,
} from "@/components/SeasonSummary";
import {
  type ConvexSeasonStanding,
  type ConvexSeasonSummary,
  loadConvexSeasonStanding,
  loadConvexSeasons,
} from "@/convex/seasons";
import { getPacificTodayPlainDate } from "@/lib/dates";
import { getProfileSeasonPath } from "@/lib/routes";
import { formatSignedPoints, ordinal } from "@/lib/seasonActivity";

const viewSeasonClass =
  "inline-flex items-center gap-1.5 text-sm font-semibold text-red-300";

function pointsLabel(count: number): string {
  return `${count} ${count === 1 ? "point" : "points"}`;
}

/**
 * Past-season standings arrive after the list, one query per season, since
 * each is its own season-wide read. Missing means still loading; "failed"
 * means that season's read failed.
 */
type StandingLookup = Record<string, ConvexSeasonStanding | "failed">;

export function ConvexProfileSeasons({ appUserId }: { appUserId: string }) {
  const convex = useConvex();
  const [seasons, setSeasons] = useState<ConvexSeasonSummary[] | null>(null);
  const [standings, setStandings] = useState<StandingLookup>({});
  const [failed, setFailed] = useState(false);
  const loadGenerationRef = useRef(0);
  const pointChange = useLatestPointChange(true);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setSeasons(null);
    setStandings({});
    setFailed(false);

    void loadConvexSeasons(convex, getPacificTodayPlainDate())
      .then((result) => {
        if (loadGenerationRef.current !== generation) {
          return;
        }
        setSeasons(result);
        for (const entry of result) {
          if (entry.isCurrent || entry.standing !== null) {
            continue;
          }
          void loadConvexSeasonStanding(convex, entry.season.id)
            .then((standing) => {
              if (loadGenerationRef.current === generation) {
                setStandings((current) => ({
                  ...current,
                  [entry.season.id]: standing,
                }));
              }
            })
            .catch(() => {
              if (loadGenerationRef.current === generation) {
                setStandings((current) => ({
                  ...current,
                  [entry.season.id]: "failed",
                }));
              }
            });
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
              <PastSeasonRow
                key={entry.season.id}
                summary={entry}
                standing={entry.standing ?? standings[entry.season.id]}
              />
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
          <PlayGameLink />
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

function formatFinish(
  standing: ConvexSeasonStanding | "failed" | undefined
): string | null {
  if (standing === undefined) {
    return null;
  }
  if (standing === "failed" || standing === null) {
    return "—";
  }
  return standing.playerCount === 1
    ? ordinal(standing.rank)
    : `${ordinal(standing.rank)} of ${standing.playerCount}`;
}

function PastSeasonRow({
  summary,
  standing,
}: {
  summary: ConvexSeasonSummary;
  standing: ConvexSeasonStanding | "failed" | undefined;
}) {
  const { season } = summary;
  const episodes = formatEpisodeCount(season.episodeCount);
  const finish = formatFinish(standing);
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
          <span className="text-zinc-400">Finished </span>
          {finish === null ? (
            <span
              className="inline-block h-3 w-12 animate-pulse rounded bg-white/10 align-middle"
              aria-label="Loading standing"
            />
          ) : (
            <strong className="text-white">{finish}</strong>
          )}
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
