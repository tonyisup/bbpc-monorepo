import type { GamePerformanceData, StandingsSeason } from "@/types/game";

type StandingsPlayer = GamePerformanceData["userSummary"][number];

export interface RankedPlayer {
  id: string;
  name: string;
  total: number;
  /** Equal totals share a rank, so two players can both be 1st. */
  rank: number;
}

export function playerName(name: string | null): string {
  return name?.trim() || "Player";
}

/**
 * Which season the standings page shows for a `?season=` value. Anything that
 * is not a listed season falls back to the newest finished season, since the
 * game page already shows the current one, then to whatever there is.
 */
export function selectStandingsSeason(
  seasons: StandingsSeason[],
  requested: string | undefined
): StandingsSeason | null {
  return (
    seasons.find((season) => season.id === requested) ??
    seasons.find((season) => !season.isCurrent) ??
    seasons[0] ??
    null
  );
}

/** Highest total first; ties keep the backend's order and share a rank. */
export function rankPlayers(userSummary: StandingsPlayer[]): RankedPlayer[] {
  const sorted = [...userSummary].sort(
    (left, right) => right.total - left.total
  );
  let rank = 0;
  return sorted.map((player, index) => {
    if (index === 0 || player.total !== sorted[index - 1]?.total) {
      rank = index + 1;
    }
    return {
      id: player.id,
      name: playerName(player.name),
      total: player.total,
      rank,
    };
  });
}

/** "Abe", "Abe and Bea", or "Abe, Bea and Cy". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * A season is over once its end date has passed. A season without an end
 * date is still running, however long ago it started.
 */
export function isSeasonFinished(
  season: Pick<StandingsSeason, "endedOn">,
  today: string
): boolean {
  return season.endedOn !== null && season.endedOn < today;
}

export function pointsLabel(points: number): string {
  return `${points} ${Math.abs(points) === 1 ? "pt" : "pts"}`;
}
