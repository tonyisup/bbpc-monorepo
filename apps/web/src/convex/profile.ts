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

const syllabusListReference = api.syllabus.mine.list;

export interface ConvexProfileSummary {
  syllabusCount: number;
  syllabusPreview: Array<z.infer<typeof syllabusEntrySchema>>;
}

export async function loadConvexProfileSummary(
  client: ConvexReactClient
): Promise<ConvexProfileSummary> {
  const pendingSyllabus = syllabusListSchema
    .parse(await client.query(syllabusListReference, {}))
    .filter((entry) => entry.assignment === null);

  return {
    syllabusCount: pendingSyllabus.length,
    syllabusPreview: pendingSyllabus.slice(0, 3),
  };
}
