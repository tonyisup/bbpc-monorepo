import type {
  ConvexSeasonOverview,
  ConvexSeasonPoint,
  ConvexSeasonWager,
} from "@/convex/seasons";
import { formatPacificDayLabel, pacificPointDay } from "@/lib/pointDays";

export interface AssignmentPointBlock {
  key: string;
  assignment: ConvexSeasonPoint["assignment"];
  points: ConvexSeasonPoint[];
}

export interface EpisodePointGroup {
  key: string;
  episode: ConvexSeasonPoint["episode"];
  subtotal: number;
  blocks: AssignmentPointBlock[];
}

/**
 * Groups a member's season points by episode, newest episode first, and
 * within an episode by assignment in the order they first appear. Points
 * without an episode (manual adjustments) go last, and points with an
 * episode but no assignment (a Quotabunga placement) go last within it.
 */
export function groupSeasonPointsByEpisode(
  points: readonly ConvexSeasonPoint[]
): EpisodePointGroup[] {
  const groups = new Map<string, EpisodePointGroup>();
  for (const point of points) {
    const key = point.episode?.id ?? "none";
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, episode: point.episode, subtotal: 0, blocks: [] };
      groups.set(key, group);
    }
    group.subtotal += point.total;
    const blockKey = point.assignment?.id ?? "none";
    let block = group.blocks.find((candidate) => candidate.key === blockKey);
    if (block === undefined) {
      block = { key: blockKey, assignment: point.assignment, points: [] };
      group.blocks.push(block);
    }
    block.points.push(point);
  }
  const rank = (block: AssignmentPointBlock) =>
    block.assignment === null ? 1 : 0;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      blocks: [...group.blocks].sort((left, right) => rank(left) - rank(right)),
    }))
    .sort((left, right) => {
      if (left.episode === null || right.episode === null) {
        return left.episode === null ? (right.episode === null ? 0 : 1) : -1;
      }
      return right.episode.number - left.episode.number;
    });
}

export interface SeasonSeriesRow {
  date: string;
  you: number;
  comparison: number | null;
  average: number;
}

export interface SeasonSeries {
  rows: SeasonSeriesRow[];
  comparison: {
    id: string;
    name: string | null;
    label: "Leader" | "Runner-up" | "Tied";
  } | null;
}

function comparisonLabel(
  mine: number | undefined,
  other: number
): "Leader" | "Runner-up" | "Tied" {
  if (mine === undefined || mine < other) {
    return "Leader";
  }
  return mine > other ? "Runner-up" : "Tied";
}

/**
 * Cumulative totals per Pacific scoring day for the member, the season's
 * top player other than them, and the field average across everyone who
 * has scored so far. Points are awarded while recording, so a scoring day
 * stands in for an episode, as on the game page.
 */
export function buildSeasonSeries(
  overview: Pick<ConvexSeasonOverview, "userSummary" | "points">,
  userId: string
): SeasonSeries {
  const mine = overview.userSummary.find((player) => player.id === userId);
  const other =
    overview.userSummary.find((player) => player.id !== userId) ?? null;
  const comparison =
    other === null
      ? null
      : {
          id: other.id,
          name: other.name,
          label: comparisonLabel(mine?.total, other.total),
        };
  const running = new Map<string, number>();
  const rows = new Map<string, SeasonSeriesRow>();
  let fieldTotal = 0;
  for (const point of overview.points) {
    running.set(
      point.userId,
      (running.get(point.userId) ?? 0) + point.pointValue
    );
    fieldTotal += point.pointValue;
    rows.set(pacificPointDay(point.earnedAt), {
      date: formatPacificDayLabel(point.earnedAt),
      you: running.get(userId) ?? 0,
      comparison:
        comparison === null ? null : (running.get(comparison.id) ?? 0),
      average: Math.round((fieldTotal / running.size) * 10) / 10,
    });
  }
  return { rows: [...rows.values()], comparison };
}

export interface SeasonWagerSummary {
  won: number;
  lost: number;
  open: number;
  /** Points tied up in pending and locked wagers. */
  staked: number;
  /** Net points from settled wagers. */
  net: number;
}

export function summarizeSeasonWagers(
  wagers: readonly ConvexSeasonWager[]
): SeasonWagerSummary {
  const summary: SeasonWagerSummary = {
    won: 0,
    lost: 0,
    open: 0,
    staked: 0,
    net: 0,
  };
  for (const wager of wagers) {
    switch (wager.status) {
      case "won":
        summary.won += 1;
        summary.net += wager.awardPoint?.total ?? 0;
        break;
      case "lost":
        summary.lost += 1;
        summary.net += wager.awardPoint?.total ?? -wager.points;
        break;
      case "pending":
      case "locked":
        summary.open += 1;
        summary.staked += wager.points;
        break;
      default:
        break;
    }
  }
  return summary;
}

export function formatWagerRecord(summary: SeasonWagerSummary): string {
  return `${summary.won}–${summary.lost}`;
}

export function formatSignedPoints(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/** Gains read green, losses amber; red stays the site accent. Zero is a gain. */
export function signedPointsClass(value: number): string {
  return value < 0 ? "text-amber-300" : "text-emerald-400";
}

const ordinalRules = new Intl.PluralRules("en-US", { type: "ordinal" });
const ordinalSuffix: Partial<Record<Intl.LDMLPluralRule, string>> = {
  one: "st",
  two: "nd",
  few: "rd",
};

export function ordinal(value: number): string {
  return `${value}${ordinalSuffix[ordinalRules.select(value)] ?? "th"}`;
}

export const WAGER_STATUS_LABELS: Record<ConvexSeasonWager["status"], string> =
  {
    pending: "Pending",
    locked: "Locked",
    won: "Won",
    lost: "Lost",
    rejected: "Rejected",
  };

export const ASSIGNMENT_TYPE_LABELS: Record<
  NonNullable<ConvexSeasonPoint["assignment"]>["type"],
  string
> = {
  HOMEWORK: "Homework",
  EXTRA_CREDIT: "Extra credit",
  BONUS: "Bonus",
};
