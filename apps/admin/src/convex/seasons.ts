import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const gameTypeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  lookupId: z.string(),
});

const boundedCountSchema = z.object({
  count: z.number(),
  isExact: z.boolean(),
});

export const adminSeasonSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  startedOn: z.string().nullable(),
  endedOn: z.string().nullable(),
  // Seasons created before episode counts existed omit the field.
  episodeCount: z.number().int().positive().nullable().default(null),
  gameType: gameTypeSchema,
  counts: z.object({
    points: boundedCountSchema,
    guesses: boundedCountSchema,
    gamblingEntries: boundedCountSchema,
    quoteSubmissions: boundedCountSchema,
  }),
});

const seasonsPageSchema = z.object({
  page: z.array(adminSeasonSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listGameTypesReference = api.games.config.listGameTypes;

const listSeasonsReference = api.games.seasons.listPage;

const createSeasonReference = api.games.seasons.create;

const updateSeasonReference = api.games.seasons.update;

const deleteSeasonReference = api.games.seasons.removeIfUnreferenced;

export const ADMIN_SEASONS_PAGE_SIZE = 30;

export type ConvexAdminGameType = z.infer<typeof gameTypeSchema>;
export type ConvexAdminSeason = z.infer<typeof adminSeasonSchema>;
export interface ConvexAdminSeasonInput {
  title: string;
  description: string | null;
  gameTypeId: string;
  startedOn: string;
  endedOn: string | null;
  episodeCount: number | null;
}
export interface ConvexAdminSeasonsPage {
  seasons: ConvexAdminSeason[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminGameTypes(
  client: ConvexReactClient
): Promise<ConvexAdminGameType[]> {
  return z
    .array(gameTypeSchema)
    .parse(await client.query(listGameTypesReference, {}));
}

export async function loadConvexAdminSeasonsPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminSeasonsPage> {
  const result = seasonsPageSchema.parse(
    await client.query(listSeasonsReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_SEASONS_PAGE_SIZE,
      },
    })
  );
  return {
    seasons: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function createConvexAdminSeason(
  client: ConvexReactClient,
  input: ConvexAdminSeasonInput
): Promise<void> {
  adminSeasonSchema.parse(
    await client.mutation(createSeasonReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: input.title,
      gameTypeId: documentId("gameTypes", input.gameTypeId),
      startedOn: input.startedOn,
      ...(input.description === null ? {} : { description: input.description }),
      ...(input.endedOn === null ? {} : { endedOn: input.endedOn }),
      ...(input.episodeCount === null
        ? {}
        : { episodeCount: input.episodeCount }),
    })
  );
}

export async function updateConvexAdminSeason(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminSeasonInput
): Promise<void> {
  adminSeasonSchema.parse(
    await client.mutation(updateSeasonReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("seasons", id),
      ...input,
      gameTypeId: documentId("gameTypes", input.gameTypeId),
    })
  );
}

export async function deleteConvexAdminSeason(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteSeasonReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("seasons", id),
    })
  );
}
