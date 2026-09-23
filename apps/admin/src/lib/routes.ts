export function getAdminEpisodePath(slug: string) {
  return `/episode/${encodeURIComponent(slug)}`;
}

export function getAdminAssignmentPath(slug: string) {
  return `/assignment/${encodeURIComponent(slug)}`;
}

export function getAdminQuoteReusePath(submissionId: string) {
  return `/quotabunga/reuse/${encodeURIComponent(submissionId)}`;
}

export function getAdminQuotabungaEpisodePath(episodeId: string) {
  return `/quotabunga?episodeId=${encodeURIComponent(episodeId)}`;
}
