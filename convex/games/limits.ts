import { domainError } from "../lib/errors.js";

export const MAX_GAME_TYPES = 50;
export const MAX_GAME_POINT_TYPES = 100;
export const MAX_SEASON_PAGE_SIZE = 50;
export const MAX_SEASONS_TO_INSPECT = 100;
export const MAX_SEASON_RELATIONSHIPS_FOR_COUNT = 2000;
export const MAX_POINT_PAGE_SIZE = 100;
export const MAX_POINTS_FOR_AGGREGATE = 2000;
export const MAX_ACTIVE_WAGERS_FOR_TOTAL = 2000;
export const MAX_POINT_RELATIONSHIPS = 100;
export const MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS = 1000;
export const MAX_ASSIGNMENTS_FOR_POINT_TOTALS = 25;
export const MAX_USERS_FOR_POINT_TOTALS = 100;
export const MAX_GUESS_PAGE_SIZE = 100;
export const MAX_GUESSES_PER_ASSIGNMENT = 500;
export const MAX_ASSIGNMENTS_FOR_GUESS_READ = 25;
export const MAX_HOST_GUESSES_PER_BATCH = 25;

export function validateSeasonPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_SEASON_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Season page size must be an integer from 1 through ${String(MAX_SEASON_PAGE_SIZE)}.`,
    );
  }
}

export function validatePointPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_POINT_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Point page size must be an integer from 1 through ${String(MAX_POINT_PAGE_SIZE)}.`,
    );
  }
}

export function validateGuessPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_GUESS_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Guess page size must be an integer from 1 through ${String(MAX_GUESS_PAGE_SIZE)}.`,
    );
  }
}
