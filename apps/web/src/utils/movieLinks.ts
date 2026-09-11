export type MovieLinkPreference = "imdb" | "tmdb";

/** Keep the catalog URL as a fallback when the preferred site's ID is absent. */
export function getMovieLink(
  movie: { url: string; tmdbId?: number | null },
  preference: MovieLinkPreference = "imdb"
): string {
  if (
    preference === "tmdb" &&
    typeof movie.tmdbId === "number" &&
    Number.isSafeInteger(movie.tmdbId) &&
    movie.tmdbId > 0
  ) {
    return `https://www.themoviedb.org/movie/${String(movie.tmdbId)}`;
  }
  return movie.url;
}
