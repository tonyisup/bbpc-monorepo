export function getEpisodePath(slug: string) {
  return `/episodes/${slug}`;
}

export function getEpisodeExtrasAddPath(slug: string) {
  return `/episodes/${slug}/extras/add`;
}

export function getAssignmentPath(slug: string) {
  return `/assignment/${slug}`;
}

export function getProfileSeasonPath(seasonId: string) {
  return `/profile/seasons/${seasonId}`;
}

/** Where a listener enters the Quotabunga round that is open now. */
export const SUBMIT_QUOTE_PATH = "/game#current-round-heading";

/** The Quotabunga archive, on one season or on "all" of them. */
export function getQuotabungaArchivePath(season?: string) {
  return season === undefined
    ? "/game/quotabunga"
    : `/game/quotabunga?season=${encodeURIComponent(season)}`;
}
