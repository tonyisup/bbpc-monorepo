import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const movieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const assignmentSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  playable: z.boolean(),
  slug: z.string().nullable(),
  episode: z.object({
    id: z.string().min(1),
    number: z.number(),
    title: z.string(),
    status: z.string().nullable(),
    slug: z.string().nullable(),
  }),
});

export const adminSyllabusEntrySchema = z.object({
  id: z.string().min(1),
  order: z.number(),
  createdAt: z.number(),
  notes: z.string().nullable(),
  movie: movieSchema,
  assignment: assignmentSchema.nullable(),
  user: z.object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    status: z.enum(["active", "disabled"]),
  }),
});

const syllabusPageSchema = z.object({
  page: z.array(adminSyllabusEntrySchema),
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

const listSyllabusReference = makeFunctionReference<
  "query",
  {
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("syllabus/admin:listPage");

const removeSyllabusReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("syllabus/admin:removeEntry");

export const ADMIN_SYLLABUS_PAGE_SIZE = 50;

export type ConvexAdminSyllabusEntry = z.infer<
  typeof adminSyllabusEntrySchema
>;

export interface ConvexAdminSyllabusPage {
  entries: ConvexAdminSyllabusEntry[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminSyllabusPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminSyllabusPage> {
  const result = syllabusPageSchema.parse(
    await client.query(listSyllabusReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_SYLLABUS_PAGE_SIZE,
      },
    })
  );
  return {
    entries: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function removeConvexAdminSyllabusEntry(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeSyllabusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  );
}
