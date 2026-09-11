import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";
import { z } from "zod";

const movieDetailsSchema = z.object({
  id: z.number().int().positive(),
  imdb_id: z
    .string()
    .regex(/^tt\d{7,}$/)
    .nullable(),
});

export async function resolveConvexMovieUrl(
  client: ConvexReactClient,
  id: number
) {
  const details = movieDetailsSchema.parse(
    await client.action(api.catalog.external.getMovie, { id })
  );
  if (details.id !== id) throw new Error("TMDB returned a different movie.");
  return details.imdb_id === null
    ? `https://www.themoviedb.org/movie/${String(id)}`
    : `https://www.imdb.com/title/${details.imdb_id}/`;
}
