import { domainError } from "../lib/errors.js";

export const MAX_EPISODE_RELATIONSHIPS = 50;
export const MAX_EPISODE_RESULT_RELATIONSHIPS = 50;
export const MAX_AUDIO_MESSAGES_PER_USER_EPISODE = 50;
export const MAX_GAMBLING_ENTRIES_PER_EPISODE_UPDATE = 200;
export const MAX_EPISODE_SLUG_ATTEMPTS = 100;
export const MAX_EPISODE_PAGE_SIZE = 50;

export function validateEpisodePageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_EPISODE_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Episode page size must be an integer from 1 through ${String(MAX_EPISODE_PAGE_SIZE)}.`,
      { details: { limit: MAX_EPISODE_PAGE_SIZE } },
    );
  }
}
