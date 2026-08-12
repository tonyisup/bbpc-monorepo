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

const listGameTypesReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/config:listGameTypes");

const listGamePointTypesReference = makeFunctionReference<
  "query",
  { gameTypeId?: string },
  unknown
>("games/config:listGamePointTypes");

const listGamblingTypesReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/gambling:listTypes");

const createGameTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    title: string;
    description?: string;
    lookupId: string;
  },
  unknown
>("games/config:createGameType");

const updateGameTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    title: string;
    description: string | null;
    lookupId: string;
  },
  unknown
>("games/config:updateGameType");

const removeGameTypeReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("games/config:removeGameType");

const createGamePointTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    gameTypeId: string;
    title: string;
    description?: string;
    lookupId: string;
    points: number;
  },
  unknown
>("games/config:createGamePointType");

const updateGamePointTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    gameTypeId: string;
    title: string;
    description: string | null;
    lookupId: string;
    points: number;
  },
  unknown
>("games/config:updateGamePointType");

const removeGamePointTypeReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("games/config:removeGamePointType");

const createGamblingTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    title: string;
    lookupId: string;
    description?: string;
    multiplier: number;
    isActive: boolean;
  },
  unknown
>("games/gambling:createType");

const updateGamblingTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    title: string;
    lookupId: string;
    description: string | null;
    multiplier: number;
    isActive: boolean;
  },
  unknown
>("games/gambling:updateType");

const removeGamblingTypeReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("games/gambling:removeType");

export type ConvexAdminGameType = z.infer<typeof gameTypeSchema>;
export type ConvexAdminGamePointType = z.infer<
  typeof gamePointTypeSchema
>;
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

export interface ConvexAdminGamblingTypeInput
  extends ConvexAdminGameTypeInput {
  multiplier: number;
  isActive: boolean;
}

export interface ConvexAdminGameCatalog {
  gameTypes: ConvexAdminGameType[];
  pointTypes: ConvexAdminGamePointType[];
  gamblingTypes: ConvexAdminGamblingType[];
}

function optionalDescription(description: string | null):
  | { description?: string }
  | Record<string, never> {
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
      id,
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
      id,
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
      gameTypeId: input.gameTypeId,
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
      id,
      ...input,
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
      id,
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
      id,
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
      id,
    })
  );
}
