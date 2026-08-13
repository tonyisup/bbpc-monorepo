import type { ConvexTmdbTitle } from "@/convex/catalog";

export async function replaceAssignmentMovieSearchResults(
  search: () => Promise<ConvexTmdbTitle[]>,
  setResults: (results: ConvexTmdbTitle[]) => void
): Promise<void> {
  setResults([]);
  setResults(await search());
}
