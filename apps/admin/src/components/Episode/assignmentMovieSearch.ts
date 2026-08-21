import type { ConvexTmdbTitle } from "@/convex/catalog";

export async function fetchAssignmentMovieSearchResults(
  requestQuery: string,
  search: (query: string) => Promise<ConvexTmdbTitle[]>,
): Promise<ConvexTmdbTitle[]> {
  return await search(requestQuery);
}
