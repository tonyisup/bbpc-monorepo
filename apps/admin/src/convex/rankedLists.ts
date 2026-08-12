import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const rankingTargetTypeSchema = z.enum(["MOVIE", "SHOW", "EPISODE"]);
const rankingStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);

const rankingTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  maxItems: z.number(),
  targetType: rankingTargetTypeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

const rankingOwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

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

const rankingEpisodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  date: z.string().nullable(),
  status: z.string().nullable(),
});

const rankingItemBaseSchema = z.object({
  id: z.string().min(1),
  rankedListId: z.string().min(1),
  rank: z.number(),
  comment: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const rankingItemSchema = z.discriminatedUnion("targetType", [
  rankingItemBaseSchema.extend({
    targetType: z.literal("movie"),
    movieId: z.string().min(1),
    showId: z.null(),
    episodeId: z.null(),
    movie: catalogMovieSchema,
    show: z.null(),
    episode: z.null(),
  }),
  rankingItemBaseSchema.extend({
    targetType: z.literal("show"),
    movieId: z.null(),
    showId: z.string().min(1),
    episodeId: z.null(),
    movie: z.null(),
    show: catalogShowSchema,
    episode: z.null(),
  }),
  rankingItemBaseSchema.extend({
    targetType: z.literal("episode"),
    movieId: z.null(),
    showId: z.null(),
    episodeId: z.string().min(1),
    movie: z.null(),
    show: z.null(),
    episode: rankingEpisodeSchema,
  }),
]);

const rankingListSummarySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  rankedListTypeId: z.string().min(1),
  status: rankingStatusSchema,
  title: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  user: rankingOwnerSchema,
  type: rankingTypeSchema,
  itemCount: z.number(),
});

const rankingListDetailSchema = rankingListSummarySchema.extend({
  items: z.array(rankingItemSchema),
});

const rankingListsPageSchema = z.object({
  page: z.array(rankingListSummarySchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const deleteListResultSchema = z.object({
  id: z.string().min(1),
  deletedItems: z.number(),
});

const deleteItemResultSchema = z.object({
  id: z.string().min(1),
  rank: z.number(),
});

const listMineReference = makeFunctionReference<
  "query",
  { targetType?: z.infer<typeof rankingTargetTypeSchema> },
  unknown
>("rankings/lists:listMine");

const listAdminPageReference = makeFunctionReference<
  "query",
  {
    userId?: string;
    rankedListTypeId?: string;
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("rankings/lists:listAdminPage");

const getListReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("rankings/lists:get");

const createListReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    rankedListTypeId: string;
    title?: string | null;
    status: z.infer<typeof rankingStatusSchema>;
  },
  unknown
>("rankings/lists:createMine");

const updateListReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    title?: string | null;
    status?: z.infer<typeof rankingStatusSchema>;
  },
  unknown
>("rankings/lists:updateAccessible");

const removeListReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("rankings/lists:removeAccessible");

const changeOwnerReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string; userId: string },
  unknown
>("rankings/lists:changeOwner");

const upsertItemReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    rankedListId: string;
    target: RankingTargetInput;
    rank: number;
    comment?: string | null;
  },
  unknown
>("rankings/items:upsert");

const moveItemReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string; newRank: number },
  unknown
>("rankings/items:move");

const removeItemReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("rankings/items:remove");

export const ADMIN_RANKED_LISTS_PAGE_SIZE = 30;

export type ConvexRankedListSummary = z.infer<
  typeof rankingListSummarySchema
>;
export type ConvexRankedListDetail = z.infer<typeof rankingListDetailSchema>;
export type ConvexRankedItem = z.infer<typeof rankingItemSchema>;
export type ConvexRankingStatus = z.infer<typeof rankingStatusSchema>;
export type RankingTargetInput =
  | { kind: "movie"; id: string }
  | { kind: "show"; id: string }
  | { kind: "episode"; id: string };

export interface ConvexAdminRankedListsPage {
  lists: ConvexRankedListSummary[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadMyConvexRankedLists(
  client: ConvexReactClient
): Promise<ConvexRankedListSummary[]> {
  return z
    .array(rankingListSummarySchema)
    .parse(await client.query(listMineReference, {}));
}

export async function loadConvexAdminRankedListsPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminRankedListsPage> {
  const result = rankingListsPageSchema.parse(
    await client.query(listAdminPageReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_RANKED_LISTS_PAGE_SIZE,
      },
    })
  );
  return {
    lists: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function loadConvexRankedList(
  client: ConvexReactClient,
  id: string
): Promise<ConvexRankedListDetail> {
  return rankingListDetailSchema.parse(
    await client.query(getListReference, { id })
  );
}

export async function createMyConvexRankedList(
  client: ConvexReactClient,
  rankedListTypeId: string
): Promise<ConvexRankedListDetail> {
  return rankingListDetailSchema.parse(
    await client.mutation(createListReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      rankedListTypeId,
      status: "DRAFT",
    })
  );
}

export async function updateConvexRankedList(
  client: ConvexReactClient,
  id: string,
  patch: {
    title?: string | null;
    status?: ConvexRankingStatus;
  }
): Promise<ConvexRankedListDetail> {
  return rankingListDetailSchema.parse(
    await client.mutation(updateListReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      ...patch,
    })
  );
}

export async function deleteConvexRankedList(
  client: ConvexReactClient,
  id: string
): Promise<number> {
  return deleteListResultSchema.parse(
    await client.mutation(removeListReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  ).deletedItems;
}

export async function changeConvexRankedListOwner(
  client: ConvexReactClient,
  id: string,
  userId: string
): Promise<ConvexRankedListDetail> {
  return rankingListDetailSchema.parse(
    await client.mutation(changeOwnerReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      userId,
    })
  );
}

export async function upsertConvexRankedItem(
  client: ConvexReactClient,
  input: {
    rankedListId: string;
    target: RankingTargetInput;
    rank: number;
    comment?: string | null;
  }
): Promise<ConvexRankedItem> {
  return rankingItemSchema.parse(
    await client.mutation(upsertItemReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function moveConvexRankedItem(
  client: ConvexReactClient,
  id: string,
  newRank: number
): Promise<ConvexRankedItem> {
  return rankingItemSchema.parse(
    await client.mutation(moveItemReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      newRank,
    })
  );
}

export async function removeConvexRankedItem(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  deleteItemResultSchema.parse(
    await client.mutation(removeItemReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  );
}
