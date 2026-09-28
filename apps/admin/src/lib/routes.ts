export function getAdminEpisodePath(slug: string) {
  return `/episode/${encodeURIComponent(slug)}`;
}

export function getAdminAssignmentPath(slug: string) {
  return `/assignment/${encodeURIComponent(slug)}`;
}

const BLIND_REUSE_PARAM = "blind";

/** With `blind`, the breakdown hides listeners' names, as judging does. */
export function getAdminQuoteReusePath(
  submissionId: string,
  { blind = false }: { blind?: boolean } = {}
) {
  const path = `/quotabunga/reuse/${encodeURIComponent(submissionId)}`;
  return blind ? `${path}?${BLIND_REUSE_PARAM}=1` : path;
}

/** Whether a reuse breakdown was opened with the `blind` option. */
export function isBlindReuseQuery(
  query: Record<string, string | string[] | undefined>
): boolean {
  return query[BLIND_REUSE_PARAM] === "1";
}

export function getAdminQuotabungaEpisodePath(episodeId: string) {
  return `/quotabunga?episodeId=${encodeURIComponent(episodeId)}`;
}
