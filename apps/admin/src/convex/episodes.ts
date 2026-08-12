import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const episodeMovieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const episodeShowSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
});

const episodeUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const episodeAssignmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["HOMEWORK", "EXTRA_CREDIT", "BONUS"]),
  playable: z.boolean(),
  slug: z.string().nullable(),
  user: episodeUserSchema,
  movie: episodeMovieSchema,
});

const episodeExtraSchema = z
  .object({
    id: z.string().min(1),
    review: z.object({
      id: z.string().min(1),
      movie: episodeMovieSchema.nullable(),
      show: episodeShowSchema.nullable(),
    }),
  })
  .superRefine((extra, context) => {
    if ((extra.review.movie === null) === (extra.review.show === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An episode extra must have exactly one media target.",
      });
    }
  });

const episodeLinkSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  text: z.string(),
});

export const adminEpisodeSummarySchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  recording: z.string().nullable(),
  date: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  slug: z.string().nullable(),
  assignments: z.array(episodeAssignmentSchema),
  extras: z.array(episodeExtraSchema),
  links: z.array(episodeLinkSchema),
});

const episodesPageSchema = z.object({
  page: z.array(adminEpisodeSummarySchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const listEpisodesReference = makeFunctionReference<
  "query",
  {
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("episodes/admin:listPage");

const searchEpisodesReference = makeFunctionReference<
  "query",
  { query: string; limit: number },
  unknown
>("episodes/public:search");

const createEpisodeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    number: number;
    title: string;
  },
  unknown
>("episodes/admin:createEpisode");

export const ADMIN_EPISODES_PAGE_SIZE = 20;

export type ConvexAdminEpisode = z.infer<typeof adminEpisodeSummarySchema>;

export interface ConvexAdminEpisodesPage {
  episodes: ConvexAdminEpisode[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminEpisodesPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminEpisodesPage> {
  const result = episodesPageSchema.parse(
    await client.query(listEpisodesReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_EPISODES_PAGE_SIZE,
      },
    })
  );
  return {
    episodes: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function createConvexAdminEpisode(
  client: ConvexReactClient,
  input: { number: number; title: string }
): Promise<void> {
  adminEpisodeSummarySchema.parse(
    await client.mutation(createEpisodeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      number: input.number,
      title: input.title,
    })
  );
}

export async function searchConvexAdminEpisodes(
  client: ConvexReactClient,
  query: string
): Promise<ConvexAdminEpisode[]> {
  return z
    .array(adminEpisodeSummarySchema)
    .parse(await client.query(searchEpisodesReference, { query, limit: 10 }));
}
