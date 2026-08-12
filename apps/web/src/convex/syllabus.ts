"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";
import type { SyllabusInsertPosition } from "@/lib/syllabus";

const catalogMovieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const syllabusAssignmentSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  playable: z.boolean(),
  slug: z.string().nullable(),
  episode: z.object({
    id: z.string().min(1),
    number: z.number(),
    title: z.string(),
    status: z.string().nullable(),
    slug: z.string().nullable(),
  }),
});

const syllabusEntrySchema = z.object({
  id: z.string().min(1),
  order: z.number(),
  createdAt: z.number(),
  notes: z.string().nullable(),
  movie: catalogMovieSchema,
  assignment: syllabusAssignmentSchema.nullable(),
});

const tmdbMovieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  poster_path: z.string().nullable(),
  release_date: z.string(),
  imdb_path: z.string().nullable(),
});

const tmdbSearchSchema = z.object({
  page: z.number(),
  results: z.array(tmdbMovieSchema),
});

const syllabusListReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("syllabus/mine:list");

const searchCatalogMoviesReference = makeFunctionReference<
  "query",
  { query: string; limit: number },
  unknown
>("catalog/public:searchMovies");

const searchTmdbMoviesReference = makeFunctionReference<
  "action",
  { query: string; page?: number },
  unknown
>("catalog/external:searchMovies");

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

const addReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    movieId: string;
    position?: SyllabusInsertPosition;
  },
  unknown
>("syllabus/mine:add");

const removeReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("syllabus/mine:remove");

const reorderReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    orderedPendingIds: string[];
  },
  unknown
>("syllabus/mine:reorderPending");

const updateNotesReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    notes: string | null;
  },
  unknown
>("syllabus/mine:updateNotes");

const idResultSchema = z.object({ id: z.string().min(1) });
const reorderResultSchema = z.object({ success: z.literal(true) });

export type ConvexCatalogMovie = z.infer<typeof catalogMovieSchema>;
export type ConvexSyllabusEntry = z.infer<typeof syllabusEntrySchema>;
export type ConvexTmdbMovie = z.infer<typeof tmdbMovieSchema>;

export async function listConvexSyllabus(client: ConvexReactClient) {
  return z
    .array(syllabusEntrySchema)
    .parse(await client.query(syllabusListReference, {}));
}

export async function searchConvexCatalogMovies(
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

export async function searchConvexTmdbMovies(
  client: ConvexReactClient,
  query: string
) {
  return tmdbSearchSchema.parse(
    await client.action(searchTmdbMoviesReference, {
      query,
      page: 1,
    })
  ).results;
}

export async function upsertConvexTmdbMovie(
  client: ConvexReactClient,
  movie: ConvexTmdbMovie,
  year: number
) {
  if (movie.poster_path === null) {
    throw new Error("A poster is required to add this movie.");
  }
  return catalogMovieSchema.parse(
    await client.mutation(upsertMovieReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: movie.title,
      year,
      poster: movie.poster_path,
      url:
        movie.imdb_path ??
        `https://www.themoviedb.org/movie/${String(movie.id)}`,
      tmdbId: movie.id,
    })
  );
}

export async function addConvexSyllabusEntry(
  client: ConvexReactClient,
  movieId: string,
  position: SyllabusInsertPosition
) {
  return syllabusEntrySchema.parse(
    await client.mutation(addReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      movieId,
      position,
    })
  );
}

export async function removeConvexSyllabusEntry(
  client: ConvexReactClient,
  id: string
) {
  return idResultSchema.parse(
    await client.mutation(removeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  );
}

export async function reorderConvexSyllabus(
  client: ConvexReactClient,
  orderedPendingIds: string[]
) {
  return reorderResultSchema.parse(
    await client.mutation(reorderReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      orderedPendingIds,
    })
  );
}

export async function updateConvexSyllabusNotes(
  client: ConvexReactClient,
  id: string,
  notes: string | null
) {
  return syllabusEntrySchema.parse(
    await client.mutation(updateNotesReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      notes,
    })
  );
}
