import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const catalogMovieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const catalogShowSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
});

const tmdbTitleSchema = z.object({
  id: z.number(),
  title: z.string(),
  backdrop_path: z.string().nullable(),
  poster_path: z.string().nullable(),
  overview: z.string(),
  release_date: z.string(),
  first_air_date: z.string().nullable(),
  vote_average: z.number(),
  vote_count: z.number(),
  popularity: z.number(),
  media_type: z.string(),
  imdb_id: z.string().nullable(),
  imdb_path: z.string().nullable(),
});

const tmdbSearchResponseSchema = z.object({
  page: z.number(),
  results: z.array(tmdbTitleSchema),
});

function pageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    page: z.array(itemSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z
      .enum(["SplitRecommended", "SplitRequired"])
      .nullable()
      .optional(),
  });
}

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listMoviesPageReference = api.catalog.public.listMoviesPage;

const listShowsPageReference = api.catalog.public.listShowsPage;

const searchCatalogMoviesReference = api.catalog.public.searchMovies;

const searchCatalogShowsReference = api.catalog.public.searchShows;

const searchMoviesReference = api.catalog.external.searchMovies;

const searchShowsReference = api.catalog.external.searchShows;

const upsertMovieReference = api.catalog.write.upsertMovieByUrl;

const upsertShowReference = api.catalog.write.upsertShowByUrl;

const deleteMovieReference = api.catalog.admin.deleteMovie;

const deleteShowReference = api.catalog.admin.deleteShow;

export const ADMIN_CATALOG_PAGE_SIZE = 30;

export type ConvexAdminMovie = z.infer<typeof catalogMovieSchema>;
export type ConvexAdminShow = z.infer<typeof catalogShowSchema>;
export type ConvexTmdbTitle = z.infer<typeof tmdbTitleSchema>;

export interface ConvexAdminCatalogPage<T> {
  items: T[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminMoviesPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminCatalogPage<ConvexAdminMovie>> {
  const result = pageSchema(catalogMovieSchema).parse(
    await client.query(listMoviesPageReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_CATALOG_PAGE_SIZE,
      },
    })
  );
  return {
    items: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function loadConvexAdminShowsPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminCatalogPage<ConvexAdminShow>> {
  const result = pageSchema(catalogShowSchema).parse(
    await client.query(listShowsPageReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_CATALOG_PAGE_SIZE,
      },
    })
  );
  return {
    items: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function searchConvexTmdbMovies(
  client: ConvexReactClient,
  query: string
): Promise<ConvexTmdbTitle[]> {
  return tmdbSearchResponseSchema.parse(
    await client.action(searchMoviesReference, { query, page: 1 })
  ).results;
}

export async function searchConvexCatalogMovies(
  client: ConvexReactClient,
  query: string
): Promise<ConvexAdminMovie[]> {
  return z
    .array(catalogMovieSchema)
    .parse(
      await client.query(searchCatalogMoviesReference, { query, limit: 10 })
    );
}

export async function searchConvexCatalogShows(
  client: ConvexReactClient,
  query: string
): Promise<ConvexAdminShow[]> {
  return z
    .array(catalogShowSchema)
    .parse(
      await client.query(searchCatalogShowsReference, { query, limit: 10 })
    );
}

export async function searchConvexTmdbShows(
  client: ConvexReactClient,
  query: string
): Promise<ConvexTmdbTitle[]> {
  return tmdbSearchResponseSchema.parse(
    await client.action(searchShowsReference, { query, page: 1 })
  ).results;
}

export async function upsertConvexAdminMovie(
  client: ConvexReactClient,
  title: ConvexTmdbTitle
): Promise<ConvexAdminMovie> {
  const details = z
    .object({
      id: z.number().int().positive(),
      imdb_id: z
        .string()
        .regex(/^tt\d{7,}$/)
        .nullable(),
    })
    .parse(
      await client.action(api.catalog.external.getMovie, { id: title.id })
    );
  if (details.id !== title.id)
    throw new Error("TMDB returned a different movie.");
  return catalogMovieSchema.parse(
    await client.mutation(upsertMovieReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: title.title,
      year: plainDateYear(title.release_date),
      poster:
        title.poster_path === null
          ? ""
          : `https://image.tmdb.org/t/p/w500${title.poster_path}`,
      url:
        details.imdb_id === null
          ? `https://www.themoviedb.org/movie/${String(title.id)}`
          : `https://www.imdb.com/title/${details.imdb_id}/`,
      tmdbId: title.id,
    })
  );
}

export async function upsertConvexAdminShow(
  client: ConvexReactClient,
  title: ConvexTmdbTitle
): Promise<ConvexAdminShow> {
  return catalogShowSchema.parse(
    await client.mutation(upsertShowReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: title.title,
      year: plainDateYear(title.first_air_date ?? title.release_date),
      poster:
        title.poster_path === null
          ? ""
          : `https://image.tmdb.org/t/p/w500${title.poster_path}`,
      url: `https://www.themoviedb.org/tv/${String(title.id)}`,
    })
  );
}

export async function deleteConvexAdminMovie(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteMovieReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("movies", id),
    })
  );
}

export async function deleteConvexAdminShow(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteShowReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("shows", id),
    })
  );
}

function plainDateYear(value: string): number {
  const match = /^(\d{4})-\d{2}-\d{2}$/u.exec(value);
  return match === null ? 0 : Number(match[1]);
}
