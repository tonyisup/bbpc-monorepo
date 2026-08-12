"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";

const catalogMovieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number().int(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().int().nullable(),
});

const catalogShowSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number().int(),
  poster: z.string().nullable(),
  url: z.string(),
});

const tmdbTitleSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  poster_path: z.string().nullable(),
  release_date: z.string(),
  imdb_path: z.string().nullable(),
});

const tmdbSearchSchema = z.object({
  page: z.number(),
  results: z.array(tmdbTitleSchema),
});

const extraReviewResultSchema = z.object({
  id: z.string().min(1),
  review: z.object({ id: z.string().min(1) }),
});

const searchCatalogMoviesReference = makeFunctionReference<
  "query",
  { query: string; limit: number },
  unknown
>("catalog/public:searchMovies");

const searchCatalogShowsReference = makeFunctionReference<
  "query",
  { query: string; limit: number },
  unknown
>("catalog/public:searchShows");

const searchTmdbMoviesReference = makeFunctionReference<
  "action",
  { query: string; page?: number },
  unknown
>("catalog/external:searchMovies");

const searchTmdbShowsReference = makeFunctionReference<
  "action",
  { query: string; page?: number },
  unknown
>("catalog/external:searchShows");

const upsertMovieReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    title: string;
    year: number;
    poster: string;
    url: string;
    tmdbId?: number;
  },
  unknown
>("catalog/write:upsertMovieByUrl");

const upsertShowReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    title: string;
    year: number;
    poster: string;
    url: string;
  },
  unknown
>("catalog/write:upsertShowByUrl");

const addMovieExtraReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    movieId: string;
  },
  unknown
>("reviews/mine:addMovieExtra");

const addShowExtraReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    showId: string;
  },
  unknown
>("reviews/mine:addShowExtra");

export type ConvexExtraCatalogMovie = z.infer<typeof catalogMovieSchema>;
export type ConvexExtraCatalogShow = z.infer<typeof catalogShowSchema>;
export type ConvexExtraTmdbTitle = z.infer<typeof tmdbTitleSchema>;

export async function searchConvexExtraMovies(
  client: ConvexReactClient,
  query: string
) {
  return z.array(catalogMovieSchema).parse(
    await client.query(searchCatalogMoviesReference, {
      query,
      limit: 12,
    })
  );
}

export async function searchConvexExtraShows(
  client: ConvexReactClient,
  query: string
) {
  return z.array(catalogShowSchema).parse(
    await client.query(searchCatalogShowsReference, {
      query,
      limit: 12,
    })
  );
}

export async function searchConvexExtraTmdb(
  client: ConvexReactClient,
  kind: "movie" | "show",
  query: string
) {
  const raw =
    kind === "movie"
      ? await client.action(searchTmdbMoviesReference, { query, page: 1 })
      : await client.action(searchTmdbShowsReference, { query, page: 1 });
  return tmdbSearchSchema.parse(raw).results;
}

export async function upsertConvexExtraMovie(
  client: ConvexReactClient,
  title: ConvexExtraTmdbTitle,
  year: number
) {
  if (title.poster_path === null) {
    throw new Error("A poster is required to add this movie.");
  }
  return catalogMovieSchema.parse(
    await client.mutation(upsertMovieReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: title.title,
      year,
      poster: title.poster_path,
      url:
        title.imdb_path ??
        `https://www.themoviedb.org/movie/${String(title.id)}`,
      tmdbId: title.id,
    })
  );
}

export async function upsertConvexExtraShow(
  client: ConvexReactClient,
  title: ConvexExtraTmdbTitle,
  year: number
) {
  if (title.poster_path === null) {
    throw new Error("A poster is required to add this show.");
  }
  return catalogShowSchema.parse(
    await client.mutation(upsertShowReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: title.title,
      year,
      poster: title.poster_path,
      url:
        title.imdb_path ?? `https://www.themoviedb.org/tv/${String(title.id)}`,
    })
  );
}

export async function addMyConvexMovieExtra(
  client: ConvexReactClient,
  episodeId: string,
  movieId: string
) {
  return extraReviewResultSchema.parse(
    await client.mutation(addMovieExtraReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      movieId,
    })
  );
}

export async function addMyConvexShowExtra(
  client: ConvexReactClient,
  episodeId: string,
  showId: string
) {
  return extraReviewResultSchema.parse(
    await client.mutation(addShowExtraReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      showId,
    })
  );
}
