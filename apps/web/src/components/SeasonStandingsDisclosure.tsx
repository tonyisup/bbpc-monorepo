"use client";

import { useEffect, useState } from "react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import {
  PointChangeBadge,
  useLatestPointChange,
} from "@/components/GamePointChange";
import GamePerformanceTracking from "@/components/GamePerformanceTracking";
import {
  formatSeasonProgress,
  getSeasonProgress,
} from "@/components/SeasonProgress";
import type { GamePerformanceData } from "@/types/game";

export function SeasonStandingsDisclosure({
  data,
}: {
  data: GamePerformanceData | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const progress = data === null ? null : getSeasonProgress(data);
  const { accountStatus } = useBbpcAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // Unlike the nav badge, this one stays visible: the game page is where
  // members come to see their last-episode result.
  const pointChange = useLatestPointChange(
    mounted && accountStatus === "ready"
  );
  const change = pointChange.latest?.change ?? 0;

  return (
    <details
      className="bbpc-panel overflow-hidden"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-lg font-bold text-white hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [&::-webkit-details-marker]:hidden">
        <span>
          Season standings
          {progress !== null && (
            <span className="ml-2 text-sm font-medium text-zinc-400">
              · {formatSeasonProgress(progress)}
            </span>
          )}
          {change !== 0 && (
            <PointChangeBadge change={change} className="ml-2 align-middle" />
          )}
        </span>
        <span className="shrink-0 text-sm font-medium text-zinc-400">
          {isOpen ? "Close chart" : "Open chart"}
        </span>
      </summary>
      {pointChange.loader}
      {isOpen && (
        <div className="border-t border-white/10 p-3 sm:p-5">
          <GamePerformanceTracking data={data} />
        </div>
      )}
    </details>
  );
}
