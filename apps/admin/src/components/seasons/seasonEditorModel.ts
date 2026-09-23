// Matches MAX_SEASON_EPISODE_COUNT in the Convex backend's games/limits.ts.
export const MAX_SEASON_EPISODE_COUNT = 500;

/** Blank means no fixed length; `undefined` marks an invalid entry. */
export function parseSeasonEpisodeCount(
  value: string
): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const count = Number(trimmed);
  return Number.isSafeInteger(count) &&
    count >= 1 &&
    count <= MAX_SEASON_EPISODE_COUNT
    ? count
    : undefined;
}
