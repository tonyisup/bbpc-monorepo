"use client";

import { api } from "@tonyisup/bbpc-convex-api";

import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

const syllabusEntrySchema = z.object({
  id: z.string().min(1),
  order: z.number(),
  movie: z.object({
    id: z.string().min(1),
    title: z.string(),
    poster: z.string().nullable(),
    url: z.string(),
    tmdbId: z.number().nullable().optional(),
  }),
  assignment: z
    .object({
      id: z.string().min(1),
    })
    .passthrough()
    .nullable(),
});

const syllabusListSchema = z.array(syllabusEntrySchema);
const availablePointsSchema = z.number().finite();

const pointHistoryItemSchema = z.object({
  id: z.string().min(1),
  reason: z.string().nullable(),
  earnedAt: z.number().finite(),
  adjustment: z.number().finite().nullable(),
  total: z.number().finite(),
  season: z.object({
    id: z.string().min(1),
    title: z.string(),
    startedOn: z.string().nullable(),
    endedOn: z.string().nullable(),
  }),
  gamePointType: z
    .object({
      title: z.string(),
      description: z.string().nullable(),
      points: z.number().finite(),
    })
    .nullable(),
  user: z.object({
    id: z.string().min(1),
  }),
});

const pointHistoryPageSchema = z.object({
  page: z.array(pointHistoryItemSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
});

const syllabusListReference = api.syllabus.mine.list;

const availablePointsReference = api.games.member.myAvailablePoints;

const pointHistoryPageReference = api.games.member.myPointsPage;

export type ConvexPointHistoryItem = z.infer<typeof pointHistoryItemSchema>;
export type ConvexPointHistoryPage = z.infer<typeof pointHistoryPageSchema>;

export interface ConvexProfileSummary {
  availablePoints: number;
  syllabusCount: number;
  syllabusPreview: Array<z.infer<typeof syllabusEntrySchema>>;
}

export async function loadConvexProfileSummary(
  client: ConvexReactClient,
  today: string
): Promise<ConvexProfileSummary> {
  const [rawSyllabus, rawAvailablePoints] = await Promise.all([
    client.query(syllabusListReference, {}),
    client.query(availablePointsReference, {
      season: { kind: "current", today },
    }),
  ]);
  const pendingSyllabus = syllabusListSchema
    .parse(rawSyllabus)
    .filter((entry) => entry.assignment === null);

  return {
    availablePoints: availablePointsSchema.parse(rawAvailablePoints),
    syllabusCount: pendingSyllabus.length,
    syllabusPreview: pendingSyllabus.slice(0, 3),
  };
}

export async function loadConvexPointHistoryPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexPointHistoryPage> {
  return pointHistoryPageSchema.parse(
    await client.query(pointHistoryPageReference, {
      paginationOpts: {
        numItems: 20,
        cursor,
      },
    })
  );
}
