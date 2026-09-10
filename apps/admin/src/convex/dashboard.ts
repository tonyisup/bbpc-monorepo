import { BBPC_CLIENT_API_VERSION } from "./identity";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

const catalogMovieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  tmdbId: z.number().nullable(),
  poster: z.string().nullable(),
  url: z.string(),
});

const catalogShowSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
});

const episodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  date: z.string().nullable(),
  status: z.string().nullable(),
  slug: z.string().nullable(),
  recording: z.string().nullable(),
  assignments: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().nullable(),
      type: z.string(),
      playable: z.boolean(),
      user: z.object({
        id: z.string().min(1),
        name: z.string().nullable(),
        image: z.string().nullable(),
      }),
      movie: catalogMovieSchema,
    })
  ),
  extras: z.array(
    z.object({
      id: z.string().min(1),
      review: z.object({
        id: z.string().min(1),
        movie: catalogMovieSchema.nullable(),
        show: catalogShowSchema.nullable(),
      }),
    })
  ),
  links: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string(),
      url: z.string(),
    })
  ),
});

const dashboardOverviewSchema = z.object({
  countsReady: z.boolean(),
  counts: z
    .object({
      episodes: z.number(),
      users: z.number(),
      movies: z.number(),
      reviews: z.number(),
    })
    .nullable(),
  latestEpisode: episodeSchema.nullable(),
  upcomingEpisode: episodeSchema.nullable(),
  latestSyllabus: z.array(
    z.object({
      id: z.string().min(1),
      createdAt: z.number(),
      user: z.object({
        id: z.string().min(1),
        name: z.string().nullable(),
      }),
      movie: catalogMovieSchema,
    })
  ),
  guessStats: z.array(
    z.object({
      id: z.string().min(1),
      slug: z.string().nullable(),
      name: z.string(),
      fullTitle: z.string(),
      guesses: z.number(),
    })
  ),
});

const dashboardOverviewReference = api.admin.dashboard.overview;

export type ConvexAdminDashboard = z.infer<typeof dashboardOverviewSchema>;
export type ConvexAdminEpisode = NonNullable<
  ConvexAdminDashboard["latestEpisode"]
>;

export async function loadConvexAdminDashboard(
  client: ConvexReactClient
): Promise<ConvexAdminDashboard> {
  return dashboardOverviewSchema.parse(
    await client.query(dashboardOverviewReference, {})
  );
}

export async function initializeConvexAdminDashboard(
  client: ConvexReactClient
): Promise<void> {
  await client.mutation(api.admin.dashboardBackfill.initialize, {
    clientApiVersion: BBPC_CLIENT_API_VERSION,
  });
}
