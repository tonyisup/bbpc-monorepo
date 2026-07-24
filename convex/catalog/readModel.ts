import type { Doc } from "../_generated/dataModel.js";

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

export function toCatalogMovie(movie: Doc<"movies">) {
  return {
    id: movie._id,
    title: movie.title,
    year: movie.year,
    poster: nullable(movie.poster),
    url: movie.url,
    tmdbId: nullable(movie.tmdbId),
  };
}

export function toCatalogShow(show: Doc<"shows">) {
  return {
    id: show._id,
    title: show.title,
    year: show.year,
    poster: nullable(show.poster),
    url: show.url,
  };
}
