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
