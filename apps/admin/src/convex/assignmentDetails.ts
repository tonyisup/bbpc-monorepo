import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
});

const ratingSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.number(),
});

const assignmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["HOMEWORK", "EXTRA_CREDIT", "BONUS"]),
  playable: z.boolean(),
  slug: z.string().nullable(),
  user: userSchema.extend({ image: z.string().nullable() }),
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

const reviewSchema = z.object({
  id: z.string().min(1),
  reviewId: z.string().min(1),
  reviewer: userSchema.nullable(),
  rating: ratingSchema.nullable(),
  reviewedAt: z.number().nullable(),
  guesses: z.array(
    z.object({
      id: z.string().min(1),
      createdAt: z.number(),
      user: userSchema,
      rating: ratingSchema,
      season: z.object({
        id: z.string().min(1),
        title: z.string(),
      }),
      hasPoint: z.boolean(),
    })
  ),
});

const wagerStatusSchema = z.enum([
  "pending",
  "locked",
  "won",
  "lost",
  "rejected",
]);

const wagerSchema = z.object({
  id: z.string().min(1),
  points: z.number(),
  createdAt: z.number(),
  status: wagerStatusSchema,
  user: userSchema,
  targetUser: userSchema.nullable(),
  gamblingType: z.object({
    id: z.string().min(1),
    title: z.string(),
    multiplier: z.number(),
  }),
  awardAdjustment: z.number().nullable(),
});

const workbenchSchema = z.object({
  assignment: assignmentSchema,
  reviews: z.array(reviewSchema).max(50),
  wagers: z.array(wagerSchema).max(500),
});

const audioMessageSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  createdAt: z.number(),
  fileKey: z.string().nullable(),
  assignmentId: z.string().min(1).nullable(),
  user: userSchema.extend({
    email: z.string().nullable(),
    image: z.string().nullable(),
  }),
});

const audioPageSchema = z.object({
  page: z.array(audioMessageSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const idResultSchema = z.object({ id: z.string().min(1) });

const getBySlugReference = makeFunctionReference<
  "query",
  { slug: string },
  unknown
>("assignments/public:getBySlug");

const getWorkbenchReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("assignments/admin:getWorkbench");

const updateSlugReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    slug: string;
    expectedSlug: string | null;
  },
  unknown
>("assignments/admin:updateSlug");

const setTypeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    type: ConvexAssignmentType;
    expectedType: ConvexAssignmentType;
  },
  unknown
>("assignments/admin:setType");

const setPlayableReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    playable: boolean;
    expectedPlayable: boolean;
  },
  unknown
>("assignments/admin:setPlayable");

const updateIdentityReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    type: ConvexAssignmentType;
    playable: boolean;
    slug: string;
    expected: {
      type: ConvexAssignmentType;
      playable: boolean;
      slug: string | null;
    };
  },
  unknown
>("assignments/admin:updateIdentity");

const removeAssignmentReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expected: {
      type: ConvexAssignmentType;
      slug: string | null;
      userId: string;
      movieId: string;
      episodeId: string;
    };
  },
  unknown
>("assignments/admin:removeIfUnreferenced");

const createReviewReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    assignmentId: string;
    userId: string;
    ratingId?: string;
  },
  unknown
>("reviews/admin:createForAssignment");

const setReviewRatingReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    reviewId: string;
    ratingId: string | null;
    expectedRatingId: string | null;
  },
  unknown
>("reviews/admin:setRating");

const removeAssignmentReviewReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
  },
  unknown
>("reviews/admin:removeAssignmentIfNoGuesses");

const createGuessReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    userId: string;
    assignmentReviewId: string;
    ratingId: string;
    seasonId: string;
  },
  unknown
>("games/guesses:create");

const updateGuessRatingReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    ratingId: string;
    expectedRatingId: string;
  },
  unknown
>("games/guesses:updateRating");

const removeGuessReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expected: {
      userId: string;
      assignmentReviewId: string;
      ratingId: string;
      seasonId: string;
      createdAt: number;
      hasPoint: boolean;
    };
  },
  unknown
>("games/guesses:remove");

const updateWagerStatusReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    status: ConvexAssignmentWagerStatus;
    expectedStatus: ConvexAssignmentWagerStatus;
  },
  unknown
>("games/gambling:updateStatus");

const listAudioReference = makeFunctionReference<
  "query",
  {
    assignmentId: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  unknown
>("assignments/admin:listAudioMessages");

const removeAudioReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expected: {
      assignmentId: string | null;
      userId: string;
      url: string;
      fileKey: string | null;
      createdAt: number;
    };
  },
  unknown
>("assignments/admin:removeAudioMessage");

export const ADMIN_ASSIGNMENT_AUDIO_PAGE_SIZE = 30;

export type ConvexAssignmentWorkbench = z.infer<
  typeof workbenchSchema
>;
export type ConvexAssignmentType =
  ConvexAssignmentWorkbench["assignment"]["type"];
export type ConvexAssignmentReview =
  ConvexAssignmentWorkbench["reviews"][number];
export type ConvexAssignmentGuess =
  ConvexAssignmentReview["guesses"][number];
export type ConvexAssignmentWager =
  ConvexAssignmentWorkbench["wagers"][number];
export type ConvexAssignmentWagerStatus = z.infer<
  typeof wagerStatusSchema
>;
export type ConvexAssignmentAudioMessage = z.infer<
  typeof audioMessageSchema
>;

export interface ConvexAssignmentAudioPage {
  messages: ConvexAssignmentAudioMessage[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAssignmentWorkbench(
  client: ConvexReactClient,
  slug: string
): Promise<ConvexAssignmentWorkbench | null> {
  const route = z
    .object({ id: z.string().min(1), slug: z.string().nullable() })
    .nullable()
    .parse(await client.query(getBySlugReference, { slug }));
  if (route === null) {
    return null;
  }
  const workbench = await loadConvexAssignmentWorkbenchById(
    client,
    route.id
  );
  if (
    workbench !== null &&
    workbench.assignment.slug !== route.slug
  ) {
    throw new Error("Assignment slug changed while loading its workbench.");
  }
  return workbench;
}

export async function loadConvexAssignmentWorkbenchById(
  client: ConvexReactClient,
  id: string
): Promise<ConvexAssignmentWorkbench | null> {
  return workbenchSchema
    .nullable()
    .parse(await client.query(getWorkbenchReference, { id }));
}

export async function updateConvexAssignmentSlug(
  client: ConvexReactClient,
  assignment: ConvexAssignmentWorkbench["assignment"],
  slug: string
): Promise<ConvexAssignmentWorkbench["assignment"]> {
  return assignmentSchema.parse(
    await client.mutation(updateSlugReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      slug,
      expectedSlug: assignment.slug,
    })
  );
}

export async function updateConvexAssignmentType(
  client: ConvexReactClient,
  assignment: ConvexAssignmentWorkbench["assignment"],
  type: ConvexAssignmentType
): Promise<ConvexAssignmentWorkbench["assignment"]> {
  return assignmentSchema.parse(
    await client.mutation(setTypeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      type,
      expectedType: assignment.type,
    })
  );
}

export async function updateConvexAssignmentPlayable(
  client: ConvexReactClient,
  assignment: ConvexAssignmentWorkbench["assignment"],
  playable: boolean
): Promise<ConvexAssignmentWorkbench["assignment"]> {
  return assignmentSchema.parse(
    await client.mutation(setPlayableReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      playable,
      expectedPlayable: assignment.playable,
    })
  );
}

export async function updateConvexAssignmentIdentity(
  client: ConvexReactClient,
  input: {
    assignment: ConvexAssignmentWorkbench["assignment"];
    slug: string;
    type: ConvexAssignmentType;
    playable: boolean;
  }
): Promise<ConvexAssignmentWorkbench["assignment"]> {
  return assignmentSchema.parse(
    await client.mutation(updateIdentityReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: input.assignment.id,
      type: input.type,
      playable: input.playable,
      slug: input.slug,
      expected: {
        type: input.assignment.type,
        playable: input.assignment.playable,
        slug: input.assignment.slug,
      },
    })
  );
}

export async function deleteConvexAssignment(
  client: ConvexReactClient,
  assignment: ConvexAssignmentWorkbench["assignment"]
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeAssignmentReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      expected: {
        type: assignment.type,
        slug: assignment.slug,
        userId: assignment.user.id,
        movieId: assignment.movie.id,
        episodeId: assignment.episode.id,
      },
    })
  );
}

export async function createConvexAssignmentReview(
  client: ConvexReactClient,
  input: {
    assignmentId: string;
    userId: string;
    ratingId: string | null;
  }
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(createReviewReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      assignmentId: input.assignmentId,
      userId: input.userId,
      ...(input.ratingId === null ? {} : { ratingId: input.ratingId }),
    })
  );
}

export async function updateConvexAssignmentReviewRating(
  client: ConvexReactClient,
  review: ConvexAssignmentReview,
  ratingId: string | null
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(setReviewRatingReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      reviewId: review.reviewId,
      ratingId,
      expectedRatingId: review.rating?.id ?? null,
    })
  );
}

export async function removeConvexAssignmentReview(
  client: ConvexReactClient,
  assignmentReviewId: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeAssignmentReviewReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignmentReviewId,
    })
  );
}

export async function createConvexAssignmentGuess(
  client: ConvexReactClient,
  input: {
    userId: string;
    assignmentReviewId: string;
    ratingId: string;
    seasonId: string;
  }
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(createGuessReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAssignmentGuessRating(
  client: ConvexReactClient,
  guess: ConvexAssignmentGuess,
  ratingId: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(updateGuessRatingReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: guess.id,
      ratingId,
      expectedRatingId: guess.rating.id,
    })
  );
}

export async function removeConvexAssignmentGuess(
  client: ConvexReactClient,
  assignmentReviewId: string,
  guess: ConvexAssignmentGuess
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeGuessReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: guess.id,
      expected: {
        userId: guess.user.id,
        assignmentReviewId,
        ratingId: guess.rating.id,
        seasonId: guess.season.id,
        createdAt: guess.createdAt,
        hasPoint: guess.hasPoint,
      },
    })
  );
}

export async function updateConvexAssignmentWagerStatus(
  client: ConvexReactClient,
  wager: ConvexAssignmentWager,
  status: ConvexAssignmentWagerStatus
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(updateWagerStatusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: wager.id,
      status,
      expectedStatus: wager.status,
    })
  );
}

export async function loadConvexAssignmentAudioPage(
  client: ConvexReactClient,
  assignmentId: string,
  cursor: string | null
): Promise<ConvexAssignmentAudioPage> {
  const result = audioPageSchema.parse(
    await client.query(listAudioReference, {
      assignmentId,
      paginationOpts: {
        cursor,
        numItems: ADMIN_ASSIGNMENT_AUDIO_PAGE_SIZE,
      },
    })
  );
  result.page.forEach((message) => {
    if (message.assignmentId !== assignmentId) {
      throw new Error(
        "An audio message does not belong to the requested assignment."
      );
    }
  });
  return {
    messages: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function removeConvexAssignmentAudio(
  client: ConvexReactClient,
  message: ConvexAssignmentAudioMessage
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeAudioReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: message.id,
      expected: {
        assignmentId: message.assignmentId,
        userId: message.user.id,
        url: message.url,
        fileKey: message.fileKey,
        createdAt: message.createdAt,
      },
    })
  );
}
