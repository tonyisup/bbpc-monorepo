import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

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
    clipStartSeconds: z.number().nonnegative().nullable(),
    clipEndSeconds: z.number().nonnegative().nullable().default(null),
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

// The contract promises plain numbers; display code clamps them to 0–1.
const likelihoodSchema = z.number();

const quoteReuseReportSchema = z.object({
  submission: z.object({
    id: z.string().min(1),
    quoteText: z.string(),
    sourceTitle: z.string(),
    sourceType: quoteSourceTypeSchema,
    status: quoteStatusSchema,
    user: quoteAdminUserSchema,
    episode: quoteEpisodeSchema,
  }),
  likelihood: likelihoodSchema,
  limited: z.boolean(),
  episodes: z.array(
    z.object({
      episode: quoteEpisodeSchema.extend({
        date: z.string().nullable(),
        slug: z.string().nullable(),
      }),
      likelihood: likelihoodSchema,
      submissions: z.array(
        z.object({
          id: z.string().min(1),
          quoteText: z.string(),
          sourceTitle: z.string(),
          sourceType: quoteSourceTypeSchema,
          status: quoteStatusSchema,
          // Evidence rows come from any episode, including legacy data, so one
          // unexpected placement must not reject the whole report.
          placement: z.number().nullable(),
          user: quoteAdminUserSchema,
          similarity: likelihoodSchema,
          sourceTitleMatches: z.boolean(),
          likelihood: likelihoodSchema,
        })
      ),
      transcriptPassages: z.array(
        z.object({
          start: z.number().nonnegative(),
          end: z.number().nonnegative(),
          excerpt: z.string(),
          similarity: likelihoodSchema,
          likelihood: likelihoodSchema,
        })
      ),
    })
  ),
});

const listAdminEpisodesReference = api.games.quotes.listAdminEpisodes;

const listAdminForEpisodeReference = api.games.quotes.listAdminForEpisode;

const getAdminReuseReportReference = api.games.quotes.getAdminReuseReport;

const createForUserReference = api.games.quotes.createForUser;

const updateContentReference = api.games.quotes.updateContent;

const setStatusReference = api.games.quotes.setStatus;

const randomizeIncludedReference = api.games.quotes.randomizeIncluded;

const awardPlacementsReference = api.games.quotes.awardPlacements;

const removeReference = api.games.quotes.remove;

export type ConvexQuoteSourceType = z.infer<typeof quoteSourceTypeSchema>;
export type ConvexQuoteStatus = z.infer<typeof quoteStatusSchema>;
export type ConvexQuotePlacement = z.infer<typeof quotePlacementSchema>;
export type ConvexAdminQuoteEpisode = z.infer<typeof quoteAdminEpisodeSchema>;
export type ConvexAdminQuoteSubmission = z.infer<
  typeof quoteAdminSubmissionSchema
>;
export type ConvexQuoteReuseReport = z.infer<typeof quoteReuseReportSchema>;
export type ConvexQuoteReuseEpisode = ConvexQuoteReuseReport["episodes"][number];
export type ConvexQuoteAwardSnapshot = z.infer<typeof quoteAwardSnapshotSchema>;
export type ConvexQuoteAwardResult = z.infer<typeof quoteAwardResultSchema>;

export interface ConvexQuoteContentInput {
  quoteText: string;
  sourceTitle: string;
  sourceType: ConvexQuoteSourceType;
  clipUrl: string | null;
  clipStartSeconds: number | null;
  clipEndSeconds?: number | null;
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
      await client.query(listAdminForEpisodeReference, {
        episodeId: documentId("episodes", episodeId),
      })
    );
}

export async function loadConvexAdminQuoteReuseReport(
  client: ConvexReactClient,
  id: string
): Promise<ConvexQuoteReuseReport | null> {
  return quoteReuseReportSchema.nullable().parse(
    await client.query(getAdminReuseReportReference, {
      id: documentId("quoteSubmissions", id),
    })
  );
}

const HIGH_REUSE_LIKELIHOOD = 0.6;
const MEDIUM_REUSE_LIKELIHOOD = 0.25;

function clampLikelihood(likelihood: number): number {
  return Math.min(Math.max(likelihood, 0), 1);
}

/** Format a 0–1 reuse likelihood as a whole percentage without hiding weak evidence. */
export function formatQuoteReuseLikelihood(likelihood: number): string {
  const clamped = clampLikelihood(likelihood);
  const percent = Math.round(clamped * 100);
  return clamped > 0 && percent === 0 ? "<1%" : `${String(percent)}%`;
}

/** Text and border colors for a reuse likelihood: red when likely, amber when possible. */
export function quoteReuseTone(likelihood: number): string {
  const clamped = clampLikelihood(likelihood);
  if (clamped >= HIGH_REUSE_LIKELIHOOD) {
    return "border-destructive/50 text-destructive";
  }
  if (clamped >= MEDIUM_REUSE_LIKELIHOOD) {
    return "border-amber-500/50 text-amber-700 dark:border-amber-400/50 dark:text-amber-300";
  }
  return "text-muted-foreground";
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
      episodeId: documentId("episodes", input.episodeId),
      userId: documentId("users", input.userId),
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
      id: documentId("quoteSubmissions", input.id),
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
      id: documentId("quoteSubmissions", id),
      status,
    })
  );
}

export async function randomizeConvexAdminQuotes(
  client: ConvexReactClient,
  episodeId: string,
  seed: string
): Promise<number> {
  return z.object({ count: z.number().int().nonnegative() }).parse(
    await client.mutation(randomizeIncludedReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId: documentId("episodes", episodeId),
      seed,
    })
  ).count;
}

export function snapshotConvexQuoteAwards(
  submissions: ConvexAdminQuoteSubmission[]
): ConvexQuoteAwardSnapshot[] {
  return submissions
    .filter(
      (submission) => submission.point !== null || submission.placement !== null
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
      episodeId: documentId("episodes", episodeId),
      placements: placements.map((entry) => ({
        ...entry,
        submissionId: documentId("quoteSubmissions", entry.submissionId),
      })),
      expectedAwards: z
        .array(quoteAwardSnapshotSchema)
        .parse(expectedAwards)
        .map((entry) => ({
          ...entry,
          submissionId: documentId("quoteSubmissions", entry.submissionId),
          pointId: documentId("points", entry.pointId),
        })),
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
      id: documentId("quoteSubmissions", submission.id),
      expectedAward: {
        pointId: documentId("points", submission.point?.id ?? null),
        placement: submission.placement,
      },
    })
  );
}
