"use client";

import { api } from "@tonyisup/bbpc-convex-api";

import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";
import { getPacificTodayPlainDate } from "@/lib/dates";

const quoteSourceTypeSchema = z.enum(["MOVIE", "TV", "OTHER"]);

const quoteSubmissionSchema = z.object({
  id: z.string().min(1),
  quoteText: z.string(),
  sourceTitle: z.string(),
  sourceType: quoteSourceTypeSchema,
  clipUrl: z.string().nullable(),
  clipStartSeconds: z.number().nullable(),
  listenerNotes: z.string().nullable(),
  status: z.enum(["SUBMITTED", "INCLUDED", "REJECTED"]),
  bracketOrder: z.number().nullable(),
  placement: z.number().nullable(),
  scored: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const currentQuoteSubmissionSchema = z.object({
  episode: z
    .object({
      id: z.string().min(1),
      number: z.number(),
      title: z.string(),
      status: z.string().nullable(),
    })
    .nullable(),
  isOpen: z.boolean(),
  submission: quoteSubmissionSchema.nullable(),
});

const quoteTranscriptMatchSchema = z.object({
  episodeNumber: z.number(),
  episodeTitle: z.string(),
  episodeSlug: z.string().nullable(),
  start: z.number(),
  excerpt: z.string(),
});

const possibleQuoteDuplicateSchema = z.object({
  possibleMatch: z.boolean(),
  // A backend deployed before transcript matching omits this field.
  transcriptMatches: z.array(quoteTranscriptMatchSchema).default([]),
});

const currentForMeReference = api.games.quotes.currentForMe;

const checkPossibleDuplicateReference = api.games.quotes.checkPossibleDuplicate;

const submitMineReference = api.games.quotes.submitMine;

const withdrawMineReference = api.games.quotes.withdrawMine;

const withdrawnSubmissionSchema = z.object({ id: z.string().min(1) });

export type ConvexQuoteSourceType = z.infer<typeof quoteSourceTypeSchema>;
export type ConvexQuoteSubmission = z.infer<typeof quoteSubmissionSchema>;
export type ConvexQuoteTranscriptMatch = z.infer<
  typeof quoteTranscriptMatchSchema
>;
export type ConvexCurrentQuoteSubmission = z.infer<
  typeof currentQuoteSubmissionSchema
>;

export interface ConvexQuoteSubmissionInput {
  quoteText: string;
  sourceTitle: string;
  sourceType: ConvexQuoteSourceType;
  clipUrl: string | null;
  clipStartSeconds: number | null;
  listenerNotes: string | null;
}

export async function loadConvexQuotabunga(client: ConvexReactClient) {
  return currentQuoteSubmissionSchema.parse(
    await client.query(currentForMeReference, {})
  );
}

export async function checkConvexQuotabungaDuplicate(
  client: ConvexReactClient,
  input: { quoteText: string; sourceTitle: string }
) {
  return possibleQuoteDuplicateSchema.parse(
    await client.query(checkPossibleDuplicateReference, input)
  );
}

export async function submitConvexQuotabunga(
  client: ConvexReactClient,
  input: ConvexQuoteSubmissionInput
) {
  return quoteSubmissionSchema.parse(
    await client.mutation(submitMineReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
      today: getPacificTodayPlainDate(),
    })
  );
}

export async function withdrawConvexQuotabunga(client: ConvexReactClient) {
  return withdrawnSubmissionSchema.parse(
    await client.mutation(withdrawMineReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
    })
  );
}
