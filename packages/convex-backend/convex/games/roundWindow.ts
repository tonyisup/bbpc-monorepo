import type { Doc } from "../_generated/dataModel.js";

/**
 * The one rule for when a round accepts member writes: while the episode is
 * next, or while it is recording and its prediction deadline has not passed.
 * Predictions, wagers, and Quotabunga all share it, so they lock together.
 */
export function isEpisodeRoundOpen(
  episode: Pick<Doc<"episodes">, "status" | "predictionClosesAt">,
  now: number,
): boolean {
  if (episode.status === "next") {
    return true;
  }
  return (
    episode.status === "recording" &&
    episode.predictionClosesAt !== undefined &&
    now < episode.predictionClosesAt
  );
}
