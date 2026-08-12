import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const tagSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
});

const tagVoteUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const tagVoteAwardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unawarded") }),
  z.object({
    kind: z.literal("point"),
    point: z.object({ id: z.string().min(1) }),
  }),
  z.object({ kind: z.literal("legacyAwardTombstone") }),
]);

export const adminTagVoteSchema = z.object({
  id: z.string().min(1),
  tag: z.string(),
  tmdbId: z.number(),
  isTag: z.boolean().nullable(),
  createdAt: z.number(),
  user: tagVoteUserSchema.nullable(),
  award: tagVoteAwardSchema,
});

const tagVotesPageSchema = z.object({
  page: z.array(adminTagVoteSchema),
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

const listTagsReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/tags:listCatalog");

const listVotesReference = makeFunctionReference<
  "query",
  {
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("games/tags:listVotesPage");

const createTagReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    name: string;
    description?: string;
  },
  unknown
>("games/tags:createCatalogTag");

const updateTagReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    name: string;
    description: string | null;
  },
  unknown
>("games/tags:updateCatalogTag");

const deleteTagReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("games/tags:deleteCatalogTag");

const applyVotePointsReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    today: string;
  },
  unknown
>("games/tags:applyVotePoints");

const deleteVoteReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("games/tags:deleteVote");

export const ADMIN_TAG_VOTES_PAGE_SIZE = 50;

export type ConvexAdminTag = z.infer<typeof tagSchema>;
export type ConvexAdminTagVote = z.infer<typeof adminTagVoteSchema>;

export interface ConvexAdminTagInput {
  name: string;
  description: string | null;
}

export interface ConvexAdminTagVotesPage {
  votes: ConvexAdminTagVote[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminTags(
  client: ConvexReactClient
): Promise<ConvexAdminTag[]> {
  return z.array(tagSchema).parse(await client.query(listTagsReference, {}));
}

export async function loadConvexAdminTagVotesPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminTagVotesPage> {
  const result = tagVotesPageSchema.parse(
    await client.query(listVotesReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_TAG_VOTES_PAGE_SIZE,
      },
    })
  );
  return {
    votes: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function createConvexAdminTag(
  client: ConvexReactClient,
  input: ConvexAdminTagInput
): Promise<void> {
  tagSchema.parse(
    await client.mutation(createTagReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      name: input.name,
      ...(input.description === null
        ? {}
        : { description: input.description }),
    })
  );
}

export async function updateConvexAdminTag(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminTagInput
): Promise<void> {
  tagSchema.parse(
    await client.mutation(updateTagReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      ...input,
    })
  );
}

export async function deleteConvexAdminTag(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteTagReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  );
}

export async function applyConvexAdminTagVotePoints(
  client: ConvexReactClient,
  id: string,
  today: string
): Promise<void> {
  adminTagVoteSchema.parse(
    await client.mutation(applyVotePointsReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      today,
    })
  );
}

export async function deleteConvexAdminTagVote(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteVoteReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  );
}
