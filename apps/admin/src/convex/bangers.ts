import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const bangerEpisodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  status: z.string().nullable(),
});

const bangerUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
});

const bangerSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    artist: z.string(),
    url: z.string(),
    episodeId: z.string().min(1).nullable(),
    userId: z.string().min(1).nullable(),
    episode: bangerEpisodeSchema.nullable(),
    user: bangerUserSchema.nullable(),
  })
  .superRefine((banger, context) => {
    if (
      banger.episodeId !== banger.episode?.id &&
      !(banger.episodeId === null && banger.episode === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Banger episode relationship does not match.",
      });
    }
    if (
      banger.userId !== banger.user?.id &&
      !(banger.userId === null && banger.user === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Banger user relationship does not match.",
      });
    }
  });

const bangersPageSchema = z.object({
  page: z.array(bangerSchema),
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

const listBangersReference = api.episodes.bangers.listAdminPage;

const createBangerReference = api.episodes.bangers.create;

const updateBangerReference = api.episodes.bangers.update;

const removeBangerReference = api.episodes.bangers.remove;

export const ADMIN_BANGERS_PAGE_SIZE = 30;

export type ConvexAdminBanger = z.infer<typeof bangerSchema>;

export interface ConvexAdminBangerInput {
  title: string;
  artist: string;
  url: string;
  episodeId: string | null;
  userId: string | null;
}

export interface ConvexAdminBangersPage {
  bangers: ConvexAdminBanger[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminBangersPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminBangersPage> {
  const result = bangersPageSchema.parse(
    await client.query(listBangersReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_BANGERS_PAGE_SIZE,
      },
    })
  );
  return {
    bangers: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function createConvexAdminBanger(
  client: ConvexReactClient,
  input: ConvexAdminBangerInput
): Promise<void> {
  bangerSchema.parse(
    await client.mutation(createBangerReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
      episodeId: documentId("episodes", input.episodeId),
      userId: documentId("users", input.userId),
    })
  );
}

export async function updateConvexAdminBanger(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminBangerInput
): Promise<void> {
  bangerSchema.parse(
    await client.mutation(updateBangerReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("bangers", id),
      ...input,
      episodeId: documentId("episodes", input.episodeId),
      userId: documentId("users", input.userId),
    })
  );
}

export async function deleteConvexAdminBanger(
  client: ConvexReactClient,
  banger: ConvexAdminBanger
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeBangerReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("bangers", banger.id),
      expected: {
        title: banger.title,
        artist: banger.artist,
        url: banger.url,
        episodeId: documentId("episodes", banger.episodeId),
        userId: documentId("users", banger.userId),
      },
    })
  );
}
