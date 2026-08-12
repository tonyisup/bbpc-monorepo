import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

export const sideEffectStatusSchema = z.enum([
  "pending",
  "processing",
  "retryScheduled",
  "succeeded",
  "terminal",
]);

const sideEffectResourceTypeSchema = z.enum([
  "episodeAudioMessage",
  "assignmentAudioMessage",
  "profileImage",
]);

const sideEffectIntentSchema = z.object({
  id: z.string().min(1),
  operation: z.literal("uploadthing.deleteFile"),
  resourceType: sideEffectResourceTypeSchema,
  resourceId: z.string().min(1),
  status: sideEffectStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.number().nullable(),
  lastAttemptAt: z.number().nullable(),
  lastErrorCode: z.string().nullable(),
  completedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const sideEffectPageSchema = z.object({
  page: z.array(sideEffectIntentSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const listSideEffectsReference = makeFunctionReference<
  "query",
  {
    status?: z.infer<typeof sideEffectStatusSchema>;
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("sideEffects/intents:list");

const redriveSideEffectReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expectedStatus: z.infer<typeof sideEffectStatusSchema>;
    expectedUpdatedAt: number;
  },
  unknown
>("sideEffects/intents:redrive");

export const ADMIN_SIDE_EFFECT_PAGE_SIZE = 30;

export type ConvexSideEffectStatus = z.infer<
  typeof sideEffectStatusSchema
>;
export type ConvexSideEffectIntent = z.infer<
  typeof sideEffectIntentSchema
>;

export interface ConvexSideEffectPage {
  intents: ConvexSideEffectIntent[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexSideEffectPage(
  client: ConvexReactClient,
  cursor: string | null,
  status?: ConvexSideEffectStatus
): Promise<ConvexSideEffectPage> {
  const result = sideEffectPageSchema.parse(
    await client.query(listSideEffectsReference, {
      ...(status === undefined ? {} : { status }),
      paginationOpts: {
        cursor,
        numItems: ADMIN_SIDE_EFFECT_PAGE_SIZE,
      },
    })
  );
  return {
    intents: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function redriveConvexSideEffect(
  client: ConvexReactClient,
  intent: ConvexSideEffectIntent
): Promise<ConvexSideEffectIntent> {
  return sideEffectIntentSchema.parse(
    await client.mutation(redriveSideEffectReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: intent.id,
      expectedStatus: intent.status,
      expectedUpdatedAt: intent.updatedAt,
    })
  );
}
