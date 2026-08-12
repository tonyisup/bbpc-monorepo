export function getAdminEpisodePath(slug: string) {
  return `/episode/${encodeURIComponent(slug)}`;
}

export function getAdminAssignmentPath(slug: string) {
  return `/assignment/${encodeURIComponent(slug)}`;
}
