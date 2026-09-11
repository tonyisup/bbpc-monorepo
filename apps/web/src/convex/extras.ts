"use client";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";

import { api } from "@tonyisup/bbpc-convex-api";

import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";
import { resolveConvexMovieUrl } from "@/convex/movieUrl";

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

const searchCatalogMoviesReference = api.catalog.public.searchMovies;

const searchCatalogShowsReference = api.catalog.public.searchShows;

const searchTmdbMoviesReference = api.catalog.external.searchMovies;

const searchTmdbShowsReference = api.catalog.external.searchShows;

const upsertMovieReference = api.catalog.write.upsertMovieByUrl;

const upsertShowReference = api.catalog.write.upsertShowByUrl;

const addMovieExtraReference = api.reviews.mine.addMovieExtra;

const addShowExtraReference = api.reviews.mine.addShowExtra;

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
  const url = await resolveConvexMovieUrl(client, title.id);
  return catalogMovieSchema.parse(
    await client.mutation(upsertMovieReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: title.title,
      year,
      poster: title.poster_path,
      url,
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
      episodeId: documentId("episodes", episodeId),
      movieId: documentId("movies", movieId),
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
      episodeId: documentId("episodes", episodeId),
      showId: documentId("shows", showId),
    })
  );
}
