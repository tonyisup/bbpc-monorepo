import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
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

const listGameTypesReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/config:listGameTypes");

const listSeasonsReference = makeFunctionReference<
  "query",
  {
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("games/seasons:listPage");

const createSeasonReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    title: string;
    description?: string;
    gameTypeId: string;
    startedOn: string;
    endedOn?: string | null;
  },
  unknown
>("games/seasons:create");

const updateSeasonReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    title: string;
    description: string | null;
    gameTypeId: string;
    startedOn: string;
    endedOn: string | null;
  },
  unknown
>("games/seasons:update");

const deleteSeasonReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("games/seasons:removeIfUnreferenced");

export const ADMIN_SEASONS_PAGE_SIZE = 30;

export type ConvexAdminGameType = z.infer<typeof gameTypeSchema>;
export type ConvexAdminSeason = z.infer<typeof adminSeasonSchema>;
export interface ConvexAdminSeasonInput {
  title: string;
  description: string | null;
  gameTypeId: string;
  startedOn: string;
  endedOn: string | null;
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
      gameTypeId: input.gameTypeId,
      startedOn: input.startedOn,
      ...(input.description === null ? {} : { description: input.description }),
      ...(input.endedOn === null ? {} : { endedOn: input.endedOn }),
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
      id,
      ...input,
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
      id,
    })
  );
}
