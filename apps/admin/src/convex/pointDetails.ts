import type { FunctionArgs } from "convex/server";
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

const pointUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const seasonSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  startedOn: z.string().nullable(),
  endedOn: z.string().nullable(),
  gameType: gameTypeSchema,
});

const assignmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["HOMEWORK", "EXTRA_CREDIT", "BONUS"]),
  playable: z.boolean(),
  slug: z.string().nullable(),
  user: z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    image: z.string().nullable(),
    status: z.enum(["active", "disabled"]),
  }),
  movie: z.object({
    id: z.string().min(1),
    title: z.string(),
    year: z.number(),
    poster: z.string().nullable(),
    url: z.string(),
    tmdbId: z.number().nullable(),
  }),
  episode: z.object({
    id: z.string().min(1),
    number: z.number(),
    title: z.string(),
    status: z.string().nullable(),
    slug: z.string().nullable(),
  }),
});

const pointCoreSchema = z.object({
  id: z.string().min(1),
  user: pointUserSchema,
  season: seasonSchema,
  reason: z.string().nullable(),
  earnedAt: z.number(),
  adjustment: z.number().nullable(),
  gamePointType: gamePointTypeSchema.nullable(),
  total: z.number(),
});

const assignmentLinkSchema = z.object({
  id: z.string().min(1),
  assignment: assignmentSchema,
});

const pointDetailSchema = pointCoreSchema.extend({
  assignmentLinks: z.array(assignmentLinkSchema).max(100),
  guesses: z
    .array(
      z.object({
        id: z.string().min(1),
        assignmentReviewId: z.string().min(1),
      })
    )
    .max(100),
  gamblingEntries: z.array(z.object({ id: z.string().min(1) })).max(100),
  tagVotes: z
    .array(
      z.object({
        id: z.string().min(1),
        tag: z.string(),
      })
    )
    .max(100),
  quoteSubmissions: z.array(z.object({ id: z.string().min(1) })).max(100),
});

const pointImpactSchema = z.object({
  assignmentLinkCount: z.number().int().nonnegative(),
  guessCount: z.number().int().nonnegative(),
  gamblingEntryCount: z.number().int().nonnegative(),
  tagVoteCount: z.number().int().nonnegative(),
  quoteSubmissionCount: z.number().int().nonnegative(),
});

const pointWorkbenchSchema = z.object({
  point: pointDetailSchema,
  impact: pointImpactSchema,
  guessAssignments: z
    .array(
      z.object({
        id: z.string().min(1),
        assignmentReviewId: z.string().min(1),
        assignment: assignmentSchema,
      })
    )
    .max(100),
});

const idResultSchema = z.object({ id: z.string().min(1) });
const unlinkResultSchema = z.object({ count: z.literal(1) });

const getWorkbenchReference = api.games.points.getWorkbench;

const listGamePointTypesReference = api.games.config.listGamePointTypes;

const searchAssignmentsReference = api.games.points.searchAssignmentsForLink;

const updatePointReference = api.games.points.update;

const linkAssignmentReference = api.games.points.linkAssignment;

const unlinkAssignmentReference = api.games.points.unlinkAssignment;

const removePointReference = api.games.points.remove;

export type ConvexPointWorkbench = z.infer<typeof pointWorkbenchSchema>;
export type ConvexPoint = ConvexPointWorkbench["point"];
export type ConvexPointAssignment =
  ConvexPoint["assignmentLinks"][number]["assignment"];
export type ConvexPointAssignmentLink = ConvexPoint["assignmentLinks"][number];
export type ConvexPointDeleteImpact = z.infer<typeof pointImpactSchema>;
export type ConvexPointGamePointType = z.infer<typeof gamePointTypeSchema>;

export type ConvexPointEditableSnapshot = FunctionArgs<
  typeof updatePointReference
>["expected"];

function editableSnapshot(point: ConvexPoint): ConvexPointEditableSnapshot {
  return {
    userId: documentId("users", point.user.id),
    seasonId: documentId("seasons", point.season.id),
    reason: point.reason,
    adjustment: point.adjustment,
    gamePointTypeId: documentId(
      "gamePointTypes",
      point.gamePointType?.id ?? null
    ),
    earnedAt: point.earnedAt,
  };
}

export async function loadConvexPointWorkbench(
  client: ConvexReactClient,
  id: string
): Promise<ConvexPointWorkbench | null> {
  return pointWorkbenchSchema
    .nullable()
    .parse(
      await client.query(getWorkbenchReference, {
        id: documentId("points", id),
      })
    );
}

export async function loadConvexPointGamePointTypes(
  client: ConvexReactClient
): Promise<ConvexPointGamePointType[]> {
  return z
    .array(gamePointTypeSchema)
    .parse(await client.query(listGamePointTypesReference, {}));
}

export async function searchConvexPointAssignments(
  client: ConvexReactClient,
  query: string
): Promise<ConvexPointAssignment[]> {
  return z
    .array(assignmentSchema)
    .max(30)
    .parse(await client.query(searchAssignmentsReference, { query }));
}

export async function updateConvexPoint(
  client: ConvexReactClient,
  point: ConvexPoint,
  input: {
    reason: string | null;
    adjustment: number | null;
    gamePointTypeId: string | null;
  }
): Promise<void> {
  pointCoreSchema.parse(
    await client.mutation(updatePointReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("points", point.id),
      expected: editableSnapshot(point),
      ...input,
      gamePointTypeId: documentId("gamePointTypes", input.gamePointTypeId),
    })
  );
}

export async function linkConvexPointAssignment(
  client: ConvexReactClient,
  pointId: string,
  assignmentId: string
): Promise<void> {
  assignmentLinkSchema.parse(
    await client.mutation(linkAssignmentReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      pointId: documentId("points", pointId),
      assignmentId: documentId("assignments", assignmentId),
    })
  );
}

export async function unlinkConvexPointAssignment(
  client: ConvexReactClient,
  pointId: string,
  link: ConvexPointAssignmentLink
): Promise<void> {
  unlinkResultSchema.parse(
    await client.mutation(unlinkAssignmentReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      pointId: documentId("points", pointId),
      assignmentId: documentId("assignments", link.assignment.id),
      expectedLinkId: documentId("assignmentPointLinks", link.id),
    })
  );
}

export async function deleteConvexPoint(
  client: ConvexReactClient,
  workbench: ConvexPointWorkbench
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removePointReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("points", workbench.point.id),
      expected: editableSnapshot(workbench.point),
      expectedImpact: workbench.impact,
    })
  );
}
