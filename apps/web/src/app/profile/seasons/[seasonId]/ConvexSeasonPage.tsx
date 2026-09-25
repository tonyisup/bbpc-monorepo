"use client";

import { useConvex } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { SeasonPointsChart } from "@/components/SeasonPointsChart";
import { SeasonProgress, getSeasonProgress } from "@/components/SeasonProgress";
import {
  CurrentSeasonBadge,
  PlayGameLink,
  SeasonStatTile,
  formatEpisodeCount,
  formatSeasonDates,
  formatStakedDetail,
  formatStanding,
  formatStandingDetail,
  pointsLabel,
} from "@/components/SeasonSummary";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type ConvexSeasonOverview,
  type ConvexSeasonWager,
  loadConvexSeasonOverview,
  loadConvexSeasonWagers,
} from "@/convex/seasons";
import { getPacificTodayPlainDate } from "@/lib/dates";
import {
  buildSeasonSeries,
  formatSignedPoints,
  formatWagerRecord,
  summarizeSeasonWagers,
} from "@/lib/seasonActivity";

import { ProfileAccessGate } from "../../ProfileAccessGate";
import { SeasonPointsByEpisode } from "./SeasonPointsByEpisode";
import { SeasonWagers } from "./SeasonWagers";

/** Wagers load beside the overview; a failure there only affects its tab. */
type WagerState = ConvexSeasonWager[] | "failed" | null;

const tabTriggerClass =
  "rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold text-zinc-400 hover:border-white/20 hover:text-zinc-200 data-[state=active]:border-red-500 data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none";

export function ConvexSeasonPage({ seasonId }: { seasonId: string }) {
  return (
    <ProfileAccessGate label="season" width="5xl">
      {(user) => (
        <SeasonPageContent
          key={`${user.appUserId}:${seasonId}`}
          seasonId={seasonId}
          userId={user.appUserId}
        />
      )}
    </ProfileAccessGate>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" asChild>
      <Link href="/profile">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to profile
      </Link>
    </Button>
  );
}

function playersLabel(overview: ConvexSeasonOverview): string {
  const playerCount = overview.userSummary.length;
  if (playerCount === 0) {
    return overview.pointCount > 0
      ? "Standings unavailable for a season this large"
      : "No players yet";
  }
  return playerCount === 1 ? "1 player" : `${playerCount} players`;
}

function SeasonPageContent({
  seasonId,
  userId,
}: {
  seasonId: string;
  userId: string;
}) {
  const convex = useConvex();
  const [overview, setOverview] = useState<ConvexSeasonOverview | null>(null);
  const [wagers, setWagers] = useState<WagerState>(null);
  const [failed, setFailed] = useState(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setOverview(null);
    setWagers(null);
    setFailed(false);

    void loadConvexSeasonOverview(convex, seasonId, getPacificTodayPlainDate())
      .then((result) => {
        if (loadGenerationRef.current === generation) {
          setOverview(result);
        }
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) {
          setFailed(true);
        }
      });
    void loadConvexSeasonWagers(convex, seasonId)
      .then((result) => {
        if (loadGenerationRef.current === generation) {
          setWagers(result);
        }
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) {
          setWagers("failed");
        }
      });
  }, [convex, seasonId]);

  const series = useMemo(
    () => (overview === null ? null : buildSeasonSeries(overview, userId)),
    [overview, userId]
  );

  if (failed) {
    return (
      <div className="bbpc-page max-w-5xl space-y-6">
        <BackLink />
        <div className="bbpc-panel p-6" role="alert">
          <h1 className="text-2xl font-bold text-white">
            This season could not be loaded
          </h1>
          <p className="mt-2 text-zinc-400">
            It may have been removed, or the link may be wrong.
          </p>
        </div>
      </div>
    );
  }

  if (overview === null || series === null) {
    return (
      <div className="bbpc-page max-w-5xl space-y-6">
        <BackLink />
        <div
          className="h-72 animate-pulse rounded-xl bg-white/[0.04]"
          aria-label="Loading season"
        />
      </div>
    );
  }

  const wagerSummary =
    wagers === null || wagers === "failed" ? null : summarizeSeasonWagers(wagers);
  const progress = overview.isCurrent ? getSeasonProgress(overview) : null;
  const rankingUnavailable =
    overview.pointCount > 0 && overview.points.length === 0;
  const subtitle = [
    formatSeasonDates(overview.season),
    formatEpisodeCount(overview.season.episodeCount),
    playersLabel(overview),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div className="bbpc-page max-w-5xl space-y-8">
      <BackLink />

      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <p className="bbpc-kicker">Your season</p>
          {overview.isCurrent && <CurrentSeasonBadge />}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
            {overview.season.title}
          </h1>
          {overview.isCurrent && <PlayGameLink />}
        </div>
        <p className="text-zinc-400">{subtitle}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SeasonStatTile
            label="Total earned"
            value={overview.total}
            detail={pointsLabel(overview.pointCount)}
          />
          <SeasonStatTile
            label="Available"
            value={overview.available}
            detail={formatStakedDetail(overview.total - overview.available)}
          />
          <SeasonStatTile
            label="Standing"
            value={formatStanding(overview.standing)}
            detail={formatStandingDetail(
              overview.standing,
              overview.pointCount
            )}
          />
          <SeasonStatTile
            label="Wager record"
            value={wagerSummary === null ? "—" : formatWagerRecord(wagerSummary)}
            detail={
              wagerSummary === null
                ? wagers === "failed"
                  ? "Wagers unavailable"
                  : "Loading wagers"
                : `Net ${formatSignedPoints(wagerSummary.net)}`
            }
          />
        </div>
        {progress !== null && <SeasonProgress progress={progress} />}
      </header>

      <SeasonPointsChart series={series} unavailable={rankingUnavailable} />

      <Tabs defaultValue="points" className="space-y-5">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b border-white/10 bg-transparent p-0">
          <TabsTrigger value="points" className={tabTriggerClass}>
            Points by episode
          </TabsTrigger>
          <TabsTrigger value="wagers" className={tabTriggerClass}>
            Wagers
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="points"
          forceMount
          className="mt-0 data-[state=inactive]:hidden"
        >
          <SeasonPointsByEpisode seasonId={seasonId} />
        </TabsContent>
        <TabsContent value="wagers" className="mt-0">
          {wagers === "failed" ? (
            <p className="text-sm text-red-300" role="alert">
              Your wagers for this season could not be loaded.
            </p>
          ) : wagers === null || wagerSummary === null ? (
            <div
              className="h-24 animate-pulse rounded-xl bg-white/[0.04]"
              aria-label="Loading wagers"
            />
          ) : (
            <SeasonWagers wagers={wagers} summary={wagerSummary} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
