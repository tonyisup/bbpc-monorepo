"use client";

import { useConvex } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { SeasonPointsChart } from "@/components/SeasonPointsChart";
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

interface SeasonPageData {
  overview: ConvexSeasonOverview;
  wagers: ConvexSeasonWager[];
}

const tabTriggerClass =
  "rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm font-semibold text-zinc-400 data-[state=active]:border-red-500 data-[state=active]:bg-transparent data-[state=active]:text-white data-[state=active]:shadow-none";

function pointsLabel(count: number): string {
  return `${count} ${count === 1 ? "point" : "points"}`;
}

export function ConvexSeasonPage({ seasonId }: { seasonId: string }) {
  return (
    <ProfileAccessGate label="season">
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

function SeasonPageContent({
  seasonId,
  userId,
}: {
  seasonId: string;
  userId: string;
}) {
  const convex = useConvex();
  const [data, setData] = useState<SeasonPageData | null>(null);
  const [failed, setFailed] = useState(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setData(null);
    setFailed(false);

    void Promise.all([
      loadConvexSeasonOverview(convex, seasonId, getPacificTodayPlainDate()),
      loadConvexSeasonWagers(convex, seasonId),
    ])
      .then(([overview, wagers]) => {
        if (loadGenerationRef.current === generation) {
          setData({ overview, wagers });
        }
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) {
          setFailed(true);
        }
      });
  }, [convex, seasonId]);

  const series = useMemo(
    () => (data === null ? null : buildSeasonSeries(data.overview, userId)),
    [data, userId]
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

  if (data === null || series === null) {
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

  const { overview, wagers } = data;
  const wagerSummary = summarizeSeasonWagers(wagers);
  const staked = overview.total - overview.available;
  const playerCount = overview.userSummary.length;
  const progress =
    overview.season.episodeCount !== null &&
    overview.recordedEpisodeCount !== null
      ? {
          recorded: overview.recordedEpisodeCount,
          total: overview.season.episodeCount,
        }
      : null;
  const subtitle = [
    formatSeasonDates(overview.season),
    formatEpisodeCount(overview.season.episodeCount),
    playerCount === 1 ? "1 player" : `${playerCount} players`,
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
            detail={
              staked > 0 ? `${staked} in open wagers` : "Nothing wagered"
            }
          />
          <SeasonStatTile
            label="Standing"
            value={formatStanding(overview.standing)}
            detail={formatStandingDetail(overview.standing)}
          />
          <SeasonStatTile
            label="Wager record"
            value={formatWagerRecord(wagerSummary)}
            detail={`Net ${formatSignedPoints(wagerSummary.net)}`}
          />
        </div>
        {progress !== null && <SeasonProgress progress={progress} />}
      </header>

      <SeasonPointsChart series={series} />

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
          <SeasonWagers wagers={wagers} summary={wagerSummary} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
