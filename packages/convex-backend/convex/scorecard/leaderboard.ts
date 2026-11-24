import {
  SCORECARD_CRITERIA,
  type ScorecardCriterion,
} from "./limits.js";

export type ScorecardScores = Partial<Record<ScorecardCriterion, number>>;

export interface LeaderboardCandidate {
  id: string;
  title: string;
  scores: ScorecardScores;
  unseen: boolean;
  tieOrder?: number;
}

export interface LeaderboardPlacement<T extends LeaderboardCandidate> {
  entry: T;
  position: number;
  sum: number;
  tied: boolean;
}

export function isComplete(scores: ScorecardScores): boolean {
  return SCORECARD_CRITERIA.every(
    (criterion) => scores[criterion] !== undefined,
  );
}

/** Integer sum of all 9 scores, or null when any is missing. */
export function entrySum(scores: ScorecardScores): number | null {
  let sum = 0;
  for (const criterion of SCORECARD_CRITERIA) {
    const value = scores[criterion];
    if (value === undefined) {
      return null;
    }
    sum += value;
  }
  return sum;
}

export function entryAverage(scores: ScorecardScores): number | null {
  const sum = entrySum(scores);
  return sum === null ? null : sum / SCORECARD_CRITERIA.length;
}

export function isRanked(candidate: LeaderboardCandidate): boolean {
  return !candidate.unseen && isComplete(candidate.scores);
}

function compareTieOrder(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

/**
 * Leaderboard order: higher sum first, then the user's saved tie order (unset
 * last), then title, then id so the order is total and stable.
 */
export function rankEntries<T extends LeaderboardCandidate>(
  entries: readonly T[],
): Array<LeaderboardPlacement<T>> {
  const ranked = entries
    .filter(isRanked)
    .map((entry) => ({ entry, sum: entrySum(entry.scores) ?? 0 }));
  ranked.sort(
    (left, right) =>
      right.sum - left.sum ||
      compareTieOrder(left.entry.tieOrder, right.entry.tieOrder) ||
      left.entry.title.localeCompare(right.entry.title, "en") ||
      (left.entry.id < right.entry.id ? -1 : left.entry.id > right.entry.id ? 1 : 0),
  );
  const sumCounts = new Map<number, number>();
  for (const { sum } of ranked) {
    sumCounts.set(sum, (sumCounts.get(sum) ?? 0) + 1);
  }
  return ranked.map(({ entry, sum }, index) => ({
    entry,
    position: index + 1,
    sum,
    tied: (sumCounts.get(sum) ?? 0) > 1,
  }));
}
