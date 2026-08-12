import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { adminSeasonSchema } from "./seasons";

const pointUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

const gameTypeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  lookupId: z.string(),
});

const seasonSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  startedOn: z.string().nullable(),
  endedOn: z.string().nullable(),
  gameType: gameTypeSchema,
});

const gamePointTypeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  lookupId: z.string(),
  points: z.number(),
  gameType: gameTypeSchema,
});

export const adminPointSchema = z.object({
  id: z.string().min(1),
  user: pointUserSchema,
  season: seasonSummarySchema,
  reason: z.string().nullable(),
  earnedAt: z.number(),
  adjustment: z.number().nullable(),
  gamePointType: gamePointTypeSchema.nullable(),
  total: z.number(),
});

const ratingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.number(),
  sound: z.string().nullable(),
  icon: z.string().nullable(),
  category: z.string().nullable(),
});

const movieSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
  tmdbId: z.number().nullable(),
});

const showSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  year: z.number(),
  poster: z.string().nullable(),
  url: z.string(),
});

const reviewUserSchema = pointUserSchema.extend({
  status: z.enum(["active", "disabled"]),
});

const reviewCoreSchema = z
  .object({
    id: z.string().min(1),
    user: reviewUserSchema.nullable(),
    movie: movieSchema.nullable(),
    show: showSchema.nullable(),
    rating: ratingSchema.nullable(),
    reviewedAt: z.number().nullable(),
  })
  .superRefine((review, context) => {
    if ((review.movie === null) === (review.show === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A guess review must have exactly one media target.",
      });
    }
  });

const episodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  status: z.string().nullable(),
  slug: z.string().nullable(),
});

export const adminGuessSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  user: pointUserSchema,
  rating: ratingSchema,
  assignmentReview: z.object({
    id: z.string().min(1),
    assignment: z.object({
      id: z.string().min(1),
      type: z.string(),
      playable: z.boolean(),
      episode: episodeSchema,
    }),
    review: reviewCoreSchema,
  }),
  season: seasonSummarySchema,
  point: adminPointSchema.nullable(),
});

const assignmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["HOMEWORK", "EXTRA_CREDIT", "BONUS"]),
  playable: z.boolean(),
  slug: z.string().nullable(),
  user: reviewUserSchema,
  movie: movieSchema,
  episode: episodeSchema,
});

const gamblingTypeSchema = z.object({
  id: z.string().min(1),
  lookupId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  multiplier: z.number(),
  isActive: z.boolean(),
  createdAt: z.number(),
});

export const adminGamblingEntrySchema = z.object({
  id: z.string().min(1),
  points: z.number(),
  createdAt: z.number(),
  notes: z.string().nullable(),
  status: z.enum(["pending", "locked", "won", "lost", "rejected"]),
  user: pointUserSchema,
  assignment: assignmentSchema.nullable(),
  gamblingType: gamblingTypeSchema,
  targetUser: pointUserSchema.nullable(),
  season: seasonSummarySchema.nullable(),
  awardPoint: adminPointSchema.nullable(),
});

function pageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    page: z.array(itemSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z
      .enum(["SplitRecommended", "SplitRequired"])
      .nullable()
      .optional(),
  });
}

const performanceSchema = z
  .object({
    userSummary: z.array(
      z.object({
        user: pointUserSchema,
        total: z.number(),
        guessCount: z.number().int().nonnegative(),
        gamblingCount: z.number().int().nonnegative(),
      })
    ),
    points: z.array(
      z.object({
        userId: z.string().min(1),
        earnedAt: z.number(),
        pointValue: z.number(),
      })
    ),
  })
  .superRefine((performance, context) => {
    const participantIds = new Set(
      performance.userSummary.map((summary) => summary.user.id)
    );
    performance.points.forEach((point, index) => {
      if (!participantIds.has(point.userId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A performance point references an unknown participant.",
          path: ["points", index, "userId"],
        });
      }
    });
  });

const getSeasonReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("games/seasons:getById");

const getPerformanceReference = makeFunctionReference<
  "query",
  { seasonId: string },
  unknown
>("games/seasons:getPerformance");

const listPointsReference = makeFunctionReference<
  "query",
  {
    seasonId: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  unknown
>("games/points:listForSeasonPage");

const listGuessesReference = makeFunctionReference<
  "query",
  {
    seasonId: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  unknown
>("games/guesses:listForSeasonPage");

const listGamblingReference = makeFunctionReference<
  "query",
  {
    seasonId: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  unknown
>("games/gambling:listForSeasonPage");

export const ADMIN_SEASON_ACTIVITY_PAGE_SIZE = 30;

export type ConvexAdminSeasonPerformance = z.infer<
  typeof performanceSchema
>;
export type ConvexAdminSeasonPoint = z.infer<typeof adminPointSchema>;
export type ConvexAdminSeasonGuess = z.infer<typeof adminGuessSchema>;
export type ConvexAdminSeasonGamblingEntry = z.infer<
  typeof adminGamblingEntrySchema
>;

export interface ConvexAdminSeasonActivityPage<T> {
  items: T[];
  isDone: boolean;
  continueCursor: string;
}

function assertSeasonId(
  actualId: string,
  expectedId: string,
  label: string
): void {
  if (actualId !== expectedId) {
    throw new Error(`${label} does not belong to the requested season.`);
  }
}

export async function loadConvexAdminSeasonDetail(
  client: ConvexReactClient,
  id: string
) {
  return adminSeasonSchema.nullable().parse(
    await client.query(getSeasonReference, { id })
  );
}

export async function loadConvexAdminSeasonPerformance(
  client: ConvexReactClient,
  seasonId: string
): Promise<ConvexAdminSeasonPerformance> {
  return performanceSchema.parse(
    await client.query(getPerformanceReference, { seasonId })
  );
}

async function loadSeasonPage<T>(
  client: ConvexReactClient,
  reference: Parameters<ConvexReactClient["query"]>[0],
  schema: z.ZodType<T>,
  seasonId: string,
  cursor: string | null
): Promise<ConvexAdminSeasonActivityPage<T>> {
  const result = pageSchema(schema).parse(
    await client.query(reference, {
      seasonId,
      paginationOpts: {
        cursor,
        numItems: ADMIN_SEASON_ACTIVITY_PAGE_SIZE,
      },
    })
  );
  return {
    items: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function loadConvexAdminSeasonPointsPage(
  client: ConvexReactClient,
  seasonId: string,
  cursor: string | null
): Promise<ConvexAdminSeasonActivityPage<ConvexAdminSeasonPoint>> {
  const result = await loadSeasonPage(
    client,
    listPointsReference,
    adminPointSchema,
    seasonId,
    cursor
  );
  result.items.forEach((point) =>
    assertSeasonId(point.season.id, seasonId, "Point")
  );
  return result;
}

export async function loadConvexAdminSeasonGuessesPage(
  client: ConvexReactClient,
  seasonId: string,
  cursor: string | null
): Promise<ConvexAdminSeasonActivityPage<ConvexAdminSeasonGuess>> {
  const result = await loadSeasonPage(
    client,
    listGuessesReference,
    adminGuessSchema,
    seasonId,
    cursor
  );
  result.items.forEach((guess) =>
    assertSeasonId(guess.season.id, seasonId, "Guess")
  );
  return result;
}

export async function loadConvexAdminSeasonGamblingPage(
  client: ConvexReactClient,
  seasonId: string,
  cursor: string | null
): Promise<
  ConvexAdminSeasonActivityPage<ConvexAdminSeasonGamblingEntry>
> {
  const result = await loadSeasonPage(
    client,
    listGamblingReference,
    adminGamblingEntrySchema,
    seasonId,
    cursor
  );
  result.items.forEach((entry) => {
    if (entry.season === null) {
      throw new Error(
        "A season-scoped gambling entry is missing its season."
      );
    }
    assertSeasonId(entry.season.id, seasonId, "Gambling entry");
  });
  return result;
}
