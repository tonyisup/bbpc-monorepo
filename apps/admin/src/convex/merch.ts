import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

export const MERCH_TITLE_MAX_LENGTH = 80;
export const MERCH_DESCRIPTION_MAX_LENGTH = 200;
export const MERCH_PRICE_LABEL_MAX_LENGTH = 24;
export const MERCH_BADGE_MAX_LENGTH = 20;
export const MERCH_ITEM_LIMIT = 48;
export const MERCH_URL_MAX_LENGTH = 2048;

const merchItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  priceLabel: z.string().nullable(),
  badge: z.string().nullable(),
  featured: z.boolean(),
  visible: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listReference = api.merch.admin.list;

const createReference = api.merch.admin.create;

const updateReference = api.merch.admin.update;

const setVisibleReference = api.merch.admin.setVisible;

const moveReference = api.merch.admin.move;

const removeReference = api.merch.admin.remove;

export type ConvexAdminMerchItem = z.infer<typeof merchItemSchema>;
export type ConvexMerchMoveDirection = "up" | "down";

export interface ConvexAdminMerchItemInput {
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  priceLabel: string | null;
  badge: string | null;
  featured: boolean;
  visible: boolean;
}

export async function loadConvexAdminMerchItems(
  client: ConvexReactClient
): Promise<ConvexAdminMerchItem[]> {
  return z
    .array(merchItemSchema)
    .parse(await client.query(listReference, {}));
}

export async function createConvexAdminMerchItem(
  client: ConvexReactClient,
  input: ConvexAdminMerchItemInput
): Promise<ConvexAdminMerchItem> {
  return merchItemSchema.parse(
    await client.mutation(createReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAdminMerchItem(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminMerchItemInput
): Promise<ConvexAdminMerchItem> {
  return merchItemSchema.parse(
    await client.mutation(updateReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("merchItems", id),
      ...input,
    })
  );
}

export async function setConvexAdminMerchItemVisible(
  client: ConvexReactClient,
  id: string,
  visible: boolean
): Promise<ConvexAdminMerchItem> {
  return merchItemSchema.parse(
    await client.mutation(setVisibleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("merchItems", id),
      visible,
    })
  );
}

export async function moveConvexAdminMerchItem(
  client: ConvexReactClient,
  id: string,
  direction: ConvexMerchMoveDirection
): Promise<ConvexAdminMerchItem[]> {
  return z.array(merchItemSchema).parse(
    await client.mutation(moveReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("merchItems", id),
      direction,
    })
  );
}

export async function deleteConvexAdminMerchItem(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("merchItems", id),
    })
  );
}
