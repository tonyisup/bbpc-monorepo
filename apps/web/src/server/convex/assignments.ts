import "server-only";

import { z } from "zod";

import { fetchPublicQuery, publicQueryReference } from "./client";

const assignmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["HOMEWORK", "EXTRA_CREDIT", "BONUS"]),
  playable: z.boolean(),
  slug: z.string().nullable(),
  user: z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    image: z.string().nullable(),
  }),
  movie: z.object({
    id: z.string().min(1),
    title: z.string(),
    year: z.number().int(),
    poster: z.string().nullable(),
    url: z.string(),
    tmdbId: z.number().int().nullable(),
  }),
  episode: z.object({
    id: z.string().min(1),
    number: z.number().int(),
    title: z.string(),
    status: z.string().nullable(),
    slug: z.string().nullable(),
  }),
});

const getBySlugReference = publicQueryReference<{ slug: string }>(
  "assignments/public:getBySlug"
);

const getByLegacyIdReference = publicQueryReference<{ legacyId: string }>(
  "assignments/public:getByLegacyId"
);

export type ConvexPublicAssignment = z.infer<typeof assignmentSchema>;

export async function getAssignmentBySlug(
  slug: string
): Promise<ConvexPublicAssignment | null> {
  return assignmentSchema
    .nullable()
    .parse(await fetchPublicQuery(getBySlugReference, { slug }));
}

export async function getAssignmentByLegacyId(
  legacyId: string
): Promise<ConvexPublicAssignment | null> {
  return assignmentSchema
    .nullable()
    .parse(await fetchPublicQuery(getByLegacyIdReference, { legacyId }));
}
