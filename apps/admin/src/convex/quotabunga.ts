import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const quoteSourceTypeSchema = z.enum(["MOVIE", "TV", "OTHER"]);
const quoteStatusSchema = z.enum(["SUBMITTED", "INCLUDED", "REJECTED"]);
const quotePlacementSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const quoteEpisodeSchema = z.object({
  id: z.string().min(1),
  number: z.number(),
  title: z.string(),
  status: z.string().nullable(),
});

const quoteAdminEpisodeSchema = quoteEpisodeSchema.extend({
  submissionCount: z.number().int().nonnegative(),
});

const quoteAdminUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
});

const quotePointSchema = z.object({
  id: z.string().min(1),
  adjustment: z.number().nullable(),
  reason: z.string().nullable(),
});

const quoteAdminSubmissionSchema = z
  .object({
    id: z.string().min(1),
    quoteText: z.string(),
    sourceTitle: z.string(),
    sourceType: quoteSourceTypeSchema,
    clipUrl: z.string().nullable(),
    clipStartSeconds: z.number().int().nonnegative().nullable(),
    listenerNotes: z.string().nullable(),
    status: quoteStatusSchema,
    bracketOrder: z.number().int().nullable(),
    placement: quotePlacementSchema.nullable(),
    scored: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
    userId: z.string().min(1),
    episodeId: z.string().min(1),
    seasonId: z.string().min(1),
    adminNotes: z.string().nullable(),
    user: quoteAdminUserSchema,
    episode: quoteEpisodeSchema,
    season: z.object({
      id: z.string().min(1),
      title: z.string(),
    }),
    point: quotePointSchema.nullable(),
  })
  .superRefine((submission, context) => {
    if (submission.scored !== (submission.point !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quote scored state must match its award point.",
      });
    }
    if (
      submission.userId !== submission.user.id ||
      submission.episodeId !== submission.episode.id ||
      submission.seasonId !== submission.season.id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quote canonical relationships do not match.",
      });
    }
  });

const quoteAwardSnapshotSchema = z.object({
  submissionId: z.string().min(1),
  pointId: z.string().min(1).nullable(),
  placement: quotePlacementSchema.nullable(),
});

const quoteAwardResultSchema = z.object({
  awarded: z.number().int().nonnegative(),
  cleared: z.number().int().nonnegative(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listAdminEpisodesReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/quotes:listAdminEpisodes");

const listAdminForEpisodeReference = makeFunctionReference<
  "query",
  { episodeId: string },
  unknown
>("games/quotes:listAdminForEpisode");

const createForUserReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    userId: string;
    quoteText: string;
    sourceTitle: string;
    sourceType: ConvexQuoteSourceType;
    clipUrl: string | null;
    clipStartSeconds: number | null;
    listenerNotes: string | null;
    today: string;
  },
  unknown
>("games/quotes:createForUser");

const updateContentReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    quoteText: string;
    sourceTitle: string;
    sourceType: ConvexQuoteSourceType;
    clipUrl: string | null;
    clipStartSeconds: number | null;
    listenerNotes: string | null;
    adminNotes: string | null;
  },
  unknown
>("games/quotes:updateContent");

const setStatusReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    status: ConvexQuoteStatus;
  },
  unknown
>("games/quotes:setStatus");

const randomizeIncludedReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    seed: string;
  },
  unknown
>("games/quotes:randomizeIncluded");

const awardPlacementsReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    placements: ConvexQuotePlacementInput[];
    expectedAwards: ConvexQuoteAwardSnapshot[];
  },
  unknown
>("games/quotes:awardPlacements");

const removeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expectedAward: {
      pointId: string | null;
      placement: ConvexQuotePlacement | null;
    };
  },
  unknown
>("games/quotes:remove");

export type ConvexQuoteSourceType = z.infer<typeof quoteSourceTypeSchema>;
export type ConvexQuoteStatus = z.infer<typeof quoteStatusSchema>;
export type ConvexQuotePlacement = z.infer<typeof quotePlacementSchema>;
export type ConvexAdminQuoteEpisode = z.infer<
  typeof quoteAdminEpisodeSchema
>;
export type ConvexAdminQuoteSubmission = z.infer<
  typeof quoteAdminSubmissionSchema
>;
export type ConvexQuoteAwardSnapshot = z.infer<
  typeof quoteAwardSnapshotSchema
>;
export type ConvexQuoteAwardResult = z.infer<
  typeof quoteAwardResultSchema
>;

export interface ConvexQuoteContentInput {
  quoteText: string;
  sourceTitle: string;
  sourceType: ConvexQuoteSourceType;
  clipUrl: string | null;
  clipStartSeconds: number | null;
  listenerNotes: string | null;
}

export interface ConvexQuotePlacementInput {
  submissionId: string;
  placement: ConvexQuotePlacement;
}

export async function loadConvexAdminQuoteEpisodes(
  client: ConvexReactClient
): Promise<ConvexAdminQuoteEpisode[]> {
  return z
    .array(quoteAdminEpisodeSchema)
    .parse(await client.query(listAdminEpisodesReference, {}));
}

export async function loadConvexAdminQuoteSubmissions(
  client: ConvexReactClient,
  episodeId: string
): Promise<ConvexAdminQuoteSubmission[]> {
  return z
    .array(quoteAdminSubmissionSchema)
    .parse(
      await client.query(listAdminForEpisodeReference, { episodeId })
    );
}

export async function createConvexAdminQuoteForUser(
  client: ConvexReactClient,
  input: ConvexQuoteContentInput & {
    episodeId: string;
    userId: string;
    today: string;
  }
): Promise<ConvexAdminQuoteSubmission> {
  return quoteAdminSubmissionSchema.parse(
    await client.mutation(createForUserReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAdminQuoteContent(
  client: ConvexReactClient,
  input: ConvexQuoteContentInput & {
    id: string;
    adminNotes: string | null;
  }
): Promise<ConvexAdminQuoteSubmission> {
  return quoteAdminSubmissionSchema.parse(
    await client.mutation(updateContentReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function setConvexAdminQuoteStatus(
  client: ConvexReactClient,
  id: string,
  status: ConvexQuoteStatus
): Promise<ConvexAdminQuoteSubmission> {
  return quoteAdminSubmissionSchema.parse(
    await client.mutation(setStatusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      status,
    })
  );
}

export async function randomizeConvexAdminQuotes(
  client: ConvexReactClient,
  episodeId: string,
  seed: string
): Promise<number> {
  return z
    .object({ count: z.number().int().nonnegative() })
    .parse(
      await client.mutation(randomizeIncludedReference, {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        episodeId,
        seed,
      })
    ).count;
}

export function snapshotConvexQuoteAwards(
  submissions: ConvexAdminQuoteSubmission[]
): ConvexQuoteAwardSnapshot[] {
  return submissions
    .filter(
      (submission) =>
        submission.point !== null || submission.placement !== null
    )
    .map((submission) => ({
      submissionId: submission.id,
      pointId: submission.point?.id ?? null,
      placement: submission.placement,
    }));
}

export async function awardConvexAdminQuotePlacements(
  client: ConvexReactClient,
  episodeId: string,
  placements: ConvexQuotePlacementInput[],
  expectedAwards: ConvexQuoteAwardSnapshot[]
): Promise<ConvexQuoteAwardResult> {
  return quoteAwardResultSchema.parse(
    await client.mutation(awardPlacementsReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      placements,
      expectedAwards: z.array(quoteAwardSnapshotSchema).parse(expectedAwards),
    })
  );
}

export async function deleteConvexAdminQuote(
  client: ConvexReactClient,
  submission: ConvexAdminQuoteSubmission
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: submission.id,
      expectedAward: {
        pointId: submission.point?.id ?? null,
        placement: submission.placement,
      },
    })
  );
}
