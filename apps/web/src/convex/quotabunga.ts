"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
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

const currentForMeReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("games/quotes:currentForMe");

const submitMineReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    quoteText: string;
    sourceTitle: string;
    sourceType: ConvexQuoteSourceType;
    clipUrl: string | null;
    clipStartSeconds: number | null;
    listenerNotes: string | null;
    today: string;
  },
  unknown
>("games/quotes:submitMine");

const withdrawMineReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string },
  unknown
>("games/quotes:withdrawMine");

const withdrawnSubmissionSchema = z.object({ id: z.string().min(1) });

export type ConvexQuoteSourceType = z.infer<typeof quoteSourceTypeSchema>;
export type ConvexQuoteSubmission = z.infer<typeof quoteSubmissionSchema>;
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
