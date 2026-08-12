export const PredictionRoundState = Object.freeze({
  OPEN: "OPEN",
  LOCKED: "LOCKED",
  UNAVAILABLE: "UNAVAILABLE",
});

export const PredictionRoundError = Object.freeze({
  ROUND_LOCKED: "ROUND_LOCKED",
  ASSIGNMENT_NOT_FOUND: "ASSIGNMENT_NOT_FOUND",
  INVALID_HOST: "INVALID_HOST",
  INVALID_RATING: "INVALID_RATING",
  WAGER_TYPE_UNAVAILABLE: "WAGER_TYPE_UNAVAILABLE",
});

/**
 * Keep the round-state vocabulary shared between the client and the write
 * boundary. Only the upcoming episode accepts prediction changes.
 *
 * @param {string | null | undefined} episodeStatus
 * @param {boolean} [playable]
 * @returns {(typeof PredictionRoundState)[keyof typeof PredictionRoundState]}
 */
export function getPredictionRoundState(episodeStatus, playable = true) {
  if (!playable) return PredictionRoundState.LOCKED;
  if (episodeStatus === "next") return PredictionRoundState.OPEN;
  if (episodeStatus === "recording" || episodeStatus === "published") {
    return PredictionRoundState.LOCKED;
  }
  return PredictionRoundState.UNAVAILABLE;
}
