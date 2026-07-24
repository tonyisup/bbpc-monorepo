import { domainError } from "../lib/errors.js";

export const MAX_GAME_TYPES = 50;
export const MAX_GAME_POINT_TYPES = 100;
export const MAX_SEASON_PAGE_SIZE = 50;
export const MAX_SEASONS_TO_INSPECT = 100;
export const MAX_SEASON_RELATIONSHIPS_FOR_COUNT = 2000;

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
