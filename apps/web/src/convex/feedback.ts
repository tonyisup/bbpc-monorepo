"use client";

import { api } from "@tonyisup/bbpc-convex-api";

import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

// Mirrors the backend limits so the form can stop a message it would reject.
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;
const FEEDBACK_PAGE_PATH_MAX_LENGTH = 300;

export type ConvexFeedbackCategory = "bug" | "idea" | "praise" | "other";

const submitResultSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
});

const submitReference = api.feedback.member.submit;

// Only the path is sent: query strings can carry search terms or tokens.
export function toFeedbackPagePath(pathname: string | null): string | null {
  if (
    pathname === null ||
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.length > FEEDBACK_PAGE_PATH_MAX_LENGTH ||
    /[\s\\]/u.test(pathname)
  ) {
    return null;
  }
  return pathname;
}

export async function submitConvexFeedback(
  client: ConvexReactClient,
  input: {
    category: ConvexFeedbackCategory;
    message: string;
    pagePath: string | null;
  }
) {
  return submitResultSchema.parse(
    await client.mutation(submitReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      category: input.category,
      message: input.message.trim(),
      pagePath: toFeedbackPagePath(input.pagePath),
    })
  );
}
