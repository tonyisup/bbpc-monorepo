export function getAdminEpisodePath(slug: string) {
  return `/episode/${encodeURIComponent(slug)}`;
}

export function getAdminAssignmentPath(slug: string) {
  return `/assignment/${encodeURIComponent(slug)}`;
}

/** With `blind`, the breakdown hides the entry's listener, as judging does. */
export function getAdminQuoteReusePath(
  submissionId: string,
  { blind = false }: { blind?: boolean } = {}
) {
  const path = `/quotabunga/reuse/${encodeURIComponent(submissionId)}`;
  return blind ? `${path}?blind=1` : path;
}

export function getAdminQuotabungaEpisodePath(episodeId: string) {
  return `/quotabunga?episodeId=${encodeURIComponent(episodeId)}`;
}
