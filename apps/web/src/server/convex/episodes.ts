import "server-only";

import { z } from "zod";

import { fetchPublicQuery, publicQueryReference } from "./client";
import type { CompleteEpisode } from "@/types/episode";

const PUBLIC_SEARCH_LIMIT = 20;
const HISTORY_PAGE_SIZE = 20;
const HISTORY_EPISODE_LIMIT = 1_000;

const movieSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().int().nullable(),
});

const showSchema = z.object({
  id: z.string(),
  title: z.string(),
  year: z.number().int(),
  poster: z.string().nullable(),
  url: z.string(),
});

const episodeSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  recording: z.string().nullable(),
  date: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  slug: z.string().nullable(),
  assignments: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      playable: z.boolean(),
      slug: z.string().nullable(),
      user: z.object({
        id: z.string(),
        name: z.string().nullable(),
        image: z.string().nullable(),
      }),
      movie: movieSchema,
    })
  ),
  extras: z.array(
    z.object({
      id: z.string(),
      review: z.object({
        id: z.string(),
        movie: movieSchema.nullable(),
        show: showSchema.nullable(),
      }),
    })
  ),
  links: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      text: z.string(),
    })
  ),
});

const nextScheduledReference = publicQueryReference<Record<string, never>>(
  "episodes/public:nextScheduled"
);

const latestPublishedReference = publicQueryReference<{
  onOrBefore: string;
}>("episodes/public:latestPublished");

const searchReference = publicQueryReference<{
  query: string;
  limit: number;
}>("episodes/public:search");

const listPageReference = publicQueryReference<{
  paginationOpts: {
    cursor: string | null;
    numItems: number;
  };
}>("episodes/public:listPage");

const getByLegacyIdReference = publicQueryReference<{
  legacyId: string;
}>("episodes/public:getByLegacyId");

const getBySlugReference = publicQueryReference<{
  slug: string;
}>("episodes/public:getBySlug");

const resultsReference = publicQueryReference<{
  episodeId: string;
}>("episodes/public:results");

const episodePageSchema = z.object({
  page: z.array(episodeSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
});

const episodeUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const episodeResultsSchema = z.object({
  gamblingWinners: z.array(
    z.object({
      id: z.string(),
      user: episodeUserSchema,
      points: z.number(),
      gamblingType: z.object({
        title: z.string(),
        multiplier: z.number(),
      }),
      movie: movieSchema,
    })
  ),
  guessWinners: z.array(
    z.object({
      id: z.string(),
      user: episodeUserSchema,
      host: episodeUserSchema,
      actualRating: z.number(),
      movie: movieSchema,
    })
  ),
});

export async function getNextScheduledEpisode(): Promise<CompleteEpisode | null> {
  const result = await fetchPublicQuery(nextScheduledReference, {});
  return episodeSchema.nullable().parse(result);
}

export async function getLatestPublishedEpisode(
  onOrBefore: string
): Promise<CompleteEpisode | null> {
  const result = await fetchPublicQuery(latestPublishedReference, {
    onOrBefore,
  });
  return episodeSchema.nullable().parse(result);
}

export async function searchEpisodes(
  query: string
): Promise<CompleteEpisode[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const result = await fetchPublicQuery(searchReference, {
    query: trimmedQuery,
    limit: PUBLIC_SEARCH_LIMIT,
  });
  return z.array(episodeSchema).parse(result);
}

export async function getEpisodeByLegacyId(
  legacyId: string
): Promise<CompleteEpisode | null> {
  const result = await fetchPublicQuery(getByLegacyIdReference, {
    legacyId,
  });
  return episodeSchema.nullable().parse(result);
}

export async function getEpisodeBySlug(
  slug: string
): Promise<CompleteEpisode | null> {
  const result = await fetchPublicQuery(getBySlugReference, {
    slug,
  });
  return episodeSchema.nullable().parse(result);
}

export async function getEpisodeResults(episodeId: string) {
  const result = await fetchPublicQuery(resultsReference, {
    episodeId,
  });
  return episodeResultsSchema.parse(result);
}

export async function listEpisodeHistory(): Promise<CompleteEpisode[]> {
  const episodes: CompleteEpisode[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    const result = episodePageSchema.parse(
      await fetchPublicQuery(listPageReference, {
        paginationOpts: {
          cursor,
          numItems: HISTORY_PAGE_SIZE,
        },
      })
    );

    if (episodes.length + result.page.length > HISTORY_EPISODE_LIMIT) {
      throw new Error(
        `Episode history exceeds the ${HISTORY_EPISODE_LIMIT}-episode compatibility limit.`
      );
    }
    episodes.push(...result.page);

    if (result.isDone) {
      return episodes;
    }
    if (
      result.page.length === 0 ||
      result.continueCursor === cursor ||
      seenCursors.has(result.continueCursor)
    ) {
      throw new Error("Convex episode history pagination did not advance.");
    }

    seenCursors.add(result.continueCursor);
    cursor = result.continueCursor;
  }
}
