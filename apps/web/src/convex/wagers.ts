"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";
import { getPacificTodayPlainDate } from "@/lib/dates";

const gamblingTypeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  lookupId: z.string(),
  description: z.string().nullable(),
  multiplier: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
});

const wagerTargetSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const wagerEntrySchema = z.object({
  id: z.string().min(1),
  points: z.number(),
  status: z.enum(["pending", "locked", "won", "lost", "rejected"]),
  gamblingType: gamblingTypeSchema,
  targetUser: wagerTargetSchema.nullable(),
});

const listActiveTypesReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/gambling:listActiveTypes");

const mineForAssignmentReference = makeFunctionReference<
  "query",
  { assignmentId: string },
  unknown
>("games/gambling:mineForAssignment");

const myAvailablePointsReference = makeFunctionReference<
  "query",
  { season: { kind: "current"; today: string } },
  unknown
>("games/member:myAvailablePoints");

const submitReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    gamblingTypeId: string;
    points: number;
    assignmentId: string;
    targetUserId?: string;
    today: string;
  },
  unknown
>("games/gambling:submit");

export type ConvexGamblingType = z.infer<typeof gamblingTypeSchema>;
export type ConvexWagerEntry = z.infer<typeof wagerEntrySchema>;

export interface ConvexAssignmentWagerData {
  types: ConvexGamblingType[];
  entries: ConvexWagerEntry[];
  availablePoints: number;
}

export async function loadConvexAssignmentWagers(
  client: ConvexReactClient,
  assignmentId: string
): Promise<ConvexAssignmentWagerData> {
  const today = getPacificTodayPlainDate();
  const [rawTypes, rawEntries, rawAvailablePoints] = await Promise.all([
    client.query(listActiveTypesReference, {}),
    client.query(mineForAssignmentReference, { assignmentId }),
    client.query(myAvailablePointsReference, {
      season: { kind: "current", today },
    }),
  ]);
  return {
    types: z.array(gamblingTypeSchema).parse(rawTypes),
    entries: z.array(wagerEntrySchema).parse(rawEntries),
    availablePoints: z.number().parse(rawAvailablePoints),
  };
}

export async function submitConvexWager(
  client: ConvexReactClient,
  input: {
    gamblingTypeId: string;
    points: number;
    assignmentId: string;
    targetUserId?: string;
  }
) {
  return wagerEntrySchema.parse(
    await client.mutation(submitReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      gamblingTypeId: input.gamblingTypeId,
      points: input.points,
      assignmentId: input.assignmentId,
      ...(input.targetUserId === undefined
        ? {}
        : { targetUserId: input.targetUserId }),
      today: getPacificTodayPlainDate(),
    })
  );
}
