import { domainError } from "../lib/errors.js";

export const MAX_SCORECARD_ENTRIES_PER_YEAR = 200;
export const SCORECARD_TOP_COUNT = 10;
export const MIN_SCORECARD_YEAR = 1900;
export const MAX_SCORECARD_YEAR = 2200;
export const MIN_SCORECARD_SCORE = 1;
export const MAX_SCORECARD_SCORE = 10;
/** A movie may be scored in a year within this distance of its catalog year. */
export const SCORECARD_YEAR_TOLERANCE = 1;

export const SCORECARD_CRITERIA = [
  "story",
  "performance",
  "emotion",
  "visual",
  "audio",
  "importance",
  "engagement",
  "fun",
  "replay",
] as const;

export type ScorecardCriterion = (typeof SCORECARD_CRITERIA)[number];

export function validateScorecardYear(year: number): number {
  if (
    !Number.isInteger(year) ||
    year < MIN_SCORECARD_YEAR ||
    year > MAX_SCORECARD_YEAR
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Scorecard year must be an integer from ${String(MIN_SCORECARD_YEAR)} through ${String(MAX_SCORECARD_YEAR)}.`,
    );
  }
  return year;
}

export function validateScorecardScore(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_SCORECARD_SCORE ||
    value > MAX_SCORECARD_SCORE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Scores must be whole numbers from ${String(MIN_SCORECARD_SCORE)} through ${String(MAX_SCORECARD_SCORE)}.`,
    );
  }
  return value;
}

export function validateScorecardMovieYear(
  scorecardYear: number,
  movieYear: number,
): void {
  if (Math.abs(movieYear - scorecardYear) > SCORECARD_YEAR_TOLERANCE) {
    domainError(
      "VALIDATION_FAILED",
      `Only movies from ${String(scorecardYear - SCORECARD_YEAR_TOLERANCE)} through ${String(scorecardYear + SCORECARD_YEAR_TOLERANCE)} can be scored for ${String(scorecardYear)}.`,
      { details: { scorecardYear, movieYear } },
    );
  }
}
