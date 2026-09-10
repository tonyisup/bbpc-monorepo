import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const ratingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.number(),
  sound: z.string().nullable(),
  icon: z.string().nullable(),
  category: z.string().nullable(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listRatingsReference = api.ratings.admin.list;

const createRatingReference = api.ratings.admin.create;

const updateRatingReference = api.ratings.admin.update;

const deleteRatingReference = api.ratings.admin.removeIfUnreferenced;

export type ConvexAdminRating = z.infer<typeof ratingSchema>;
export interface ConvexAdminRatingInput {
  name: string;
  value: number;
  sound: string | null;
  icon: string | null;
  category: string | null;
}

export async function loadConvexAdminRatings(
  client: ConvexReactClient
): Promise<ConvexAdminRating[]> {
  return z
    .array(ratingSchema)
    .parse(await client.query(listRatingsReference, {}));
}

export async function createConvexAdminRating(
  client: ConvexReactClient,
  input: ConvexAdminRatingInput
): Promise<void> {
  ratingSchema.parse(
    await client.mutation(createRatingReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      name: input.name,
      value: input.value,
      ...(input.sound === null ? {} : { sound: input.sound }),
      ...(input.icon === null ? {} : { icon: input.icon }),
      ...(input.category === null ? {} : { category: input.category }),
    })
  );
}

export async function updateConvexAdminRating(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminRatingInput
): Promise<void> {
  ratingSchema.parse(
    await client.mutation(updateRatingReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("ratings", id),
      ...input,
    })
  );
}

export async function deleteConvexAdminRating(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteRatingReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("ratings", id),
    })
  );
}
