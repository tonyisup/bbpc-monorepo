"use client";

import { useState } from "react";

import GamePerformanceTracking from "@/components/GamePerformanceTracking";
import type { GamePerformanceData } from "@/types/game";

export function SeasonStandingsDisclosure({
  data,
}: {
  data: GamePerformanceData | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      className="bbpc-panel overflow-hidden"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 text-lg font-bold text-white hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [&::-webkit-details-marker]:hidden">
        Season standings
        <span className="text-sm font-medium text-zinc-400">
          {isOpen ? "Close chart" : "Open chart"}
        </span>
      </summary>
      {isOpen && (
        <div className="border-t border-white/10 p-3 sm:p-5">
          <GamePerformanceTracking data={data} />
        </div>
      )}
    </details>
  );
}
