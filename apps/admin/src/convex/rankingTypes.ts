import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const rankingTargetTypeSchema = z.enum(["MOVIE", "SHOW", "EPISODE"]);

const rankingTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  maxItems: z.number(),
  targetType: rankingTargetTypeSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listRankingTypesReference = api.rankings.types.list;

const createRankingTypeReference = api.rankings.types.create;

const updateRankingTypeReference = api.rankings.types.update;

const removeRankingTypeReference = api.rankings.types.remove;

export type ConvexAdminRankingType = z.infer<typeof rankingTypeSchema>;
export type ConvexAdminRankingTargetType = z.infer<
  typeof rankingTargetTypeSchema
>;

export interface ConvexAdminRankingTypeInput {
  name: string;
  description: string | null;
  maxItems: number;
  targetType: ConvexAdminRankingTargetType;
}

export async function loadConvexAdminRankingTypes(
  client: ConvexReactClient
): Promise<ConvexAdminRankingType[]> {
  return z
    .array(rankingTypeSchema)
    .parse(await client.query(listRankingTypesReference, {}));
}

export async function createConvexAdminRankingType(
  client: ConvexReactClient,
  input: ConvexAdminRankingTypeInput
): Promise<void> {
  rankingTypeSchema.parse(
    await client.mutation(createRankingTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAdminRankingType(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminRankingTypeInput
): Promise<void> {
  rankingTypeSchema.parse(
    await client.mutation(updateRankingTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("rankedListTypes", id),
      ...input,
    })
  );
}

export async function deleteConvexAdminRankingType(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeRankingTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("rankedListTypes", id),
    })
  );
}
