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

const gamePointTypeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  lookupId: z.string(),
  points: z.number(),
  gameType: gameTypeSchema,
});

const gamblingTypeSchema = z.object({
  id: z.string().min(1),
  lookupId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  multiplier: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listGameTypesReference = api.games.config.listGameTypes;

const listGamePointTypesReference = api.games.config.listGamePointTypes;

const listGamblingTypesReference = api.games.gambling.listTypes;

const createGameTypeReference = api.games.config.createGameType;

const updateGameTypeReference = api.games.config.updateGameType;

const removeGameTypeReference = api.games.config.removeGameType;

const createGamePointTypeReference = api.games.config.createGamePointType;

const updateGamePointTypeReference = api.games.config.updateGamePointType;

const removeGamePointTypeReference = api.games.config.removeGamePointType;

const createGamblingTypeReference = api.games.gambling.createType;

const updateGamblingTypeReference = api.games.gambling.updateType;

const removeGamblingTypeReference = api.games.gambling.removeType;

export type ConvexAdminGameType = z.infer<typeof gameTypeSchema>;
export type ConvexAdminGamePointType = z.infer<typeof gamePointTypeSchema>;
export type ConvexAdminGamblingType = z.infer<typeof gamblingTypeSchema>;

export interface ConvexAdminGameTypeInput {
  title: string;
  description: string | null;
  lookupId: string;
}

export interface ConvexAdminGamePointTypeInput
  extends ConvexAdminGameTypeInput {
  gameTypeId: string;
  points: number;
}

export interface ConvexAdminGamblingTypeInput extends ConvexAdminGameTypeInput {
  multiplier: number;
  isActive: boolean;
}

export interface ConvexAdminGameCatalog {
  gameTypes: ConvexAdminGameType[];
  pointTypes: ConvexAdminGamePointType[];
  gamblingTypes: ConvexAdminGamblingType[];
}

function optionalDescription(
  description: string | null
): { description?: string } | Record<string, never> {
  return description === null ? {} : { description };
}

export async function loadConvexAdminGameCatalog(
  client: ConvexReactClient
): Promise<ConvexAdminGameCatalog> {
  const [gameTypes, pointTypes, gamblingTypes] = await Promise.all([
    client.query(listGameTypesReference, {}),
    client.query(listGamePointTypesReference, {}),
    client.query(listGamblingTypesReference, {}),
  ]);
  return {
    gameTypes: z.array(gameTypeSchema).parse(gameTypes),
    pointTypes: z.array(gamePointTypeSchema).parse(pointTypes),
    gamblingTypes: z.array(gamblingTypeSchema).parse(gamblingTypes),
  };
}

export async function createConvexAdminGameType(
  client: ConvexReactClient,
  input: ConvexAdminGameTypeInput
): Promise<void> {
  gameTypeSchema.parse(
    await client.mutation(createGameTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: input.title,
      lookupId: input.lookupId,
      ...optionalDescription(input.description),
    })
  );
}

export async function updateConvexAdminGameType(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminGameTypeInput
): Promise<void> {
  gameTypeSchema.parse(
    await client.mutation(updateGameTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gameTypes", id),
      ...input,
    })
  );
}

export async function deleteConvexAdminGameType(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeGameTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gameTypes", id),
    })
  );
}

export async function createConvexAdminGamePointType(
  client: ConvexReactClient,
  input: ConvexAdminGamePointTypeInput
): Promise<void> {
  gamePointTypeSchema.parse(
    await client.mutation(createGamePointTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      gameTypeId: documentId("gameTypes", input.gameTypeId),
      title: input.title,
      lookupId: input.lookupId,
      points: input.points,
      ...optionalDescription(input.description),
    })
  );
}

export async function updateConvexAdminGamePointType(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminGamePointTypeInput
): Promise<void> {
  gamePointTypeSchema.parse(
    await client.mutation(updateGamePointTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gamePointTypes", id),
      ...input,
      gameTypeId: documentId("gameTypes", input.gameTypeId),
    })
  );
}

export async function deleteConvexAdminGamePointType(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeGamePointTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gamePointTypes", id),
    })
  );
}

export async function createConvexAdminGamblingType(
  client: ConvexReactClient,
  input: ConvexAdminGamblingTypeInput
): Promise<void> {
  gamblingTypeSchema.parse(
    await client.mutation(createGamblingTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      title: input.title,
      lookupId: input.lookupId,
      multiplier: input.multiplier,
      isActive: input.isActive,
      ...optionalDescription(input.description),
    })
  );
}

export async function updateConvexAdminGamblingType(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminGamblingTypeInput
): Promise<void> {
  gamblingTypeSchema.parse(
    await client.mutation(updateGamblingTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gamblingTypes", id),
      ...input,
    })
  );
}

export async function deleteConvexAdminGamblingType(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeGamblingTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gamblingTypes", id),
    })
  );
}
