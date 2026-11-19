import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const categorySchema = z.enum(["bug", "idea", "praise", "other"]);
const statusSchema = z.enum(["new", "reviewed", "archived"]);

const feedbackSchema = z.object({
  id: z.string().min(1),
  category: categorySchema,
  message: z.string(),
  pagePath: z.string().nullable(),
  status: statusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  submitter: z
    .object({
      id: z.string().min(1),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
});

const feedbackPageSchema = z.object({
  items: z.array(feedbackSchema),
  hasMore: z.boolean(),
});

const feedbackCountsSchema = z.object({
  new: z.number(),
  reviewed: z.number(),
  archived: z.number(),
  cap: z.number(),
});

const idResultSchema = z.object({ id: z.string().min(1) });

const listReference = api.feedback.admin.list;
const countsReference = api.feedback.admin.counts;
const setStatusReference = api.feedback.admin.setStatus;
const removeReference = api.feedback.admin.remove;

export type ConvexFeedbackCategory = z.infer<typeof categorySchema>;
export type ConvexFeedbackStatus = z.infer<typeof statusSchema>;
export type ConvexAdminFeedback = z.infer<typeof feedbackSchema>;
export type ConvexAdminFeedbackPage = z.infer<typeof feedbackPageSchema>;
export type ConvexAdminFeedbackCounts = z.infer<typeof feedbackCountsSchema>;

export const FEEDBACK_STATUSES: readonly ConvexFeedbackStatus[] = [
  "new",
  "reviewed",
  "archived",
];

export const FEEDBACK_CATEGORY_LABELS: Record<ConvexFeedbackCategory, string> =
  {
    bug: "Bug",
    idea: "Idea",
    praise: "Praise",
    other: "Other",
  };

export const FEEDBACK_STATUS_LABELS: Record<ConvexFeedbackStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  archived: "Archived",
};

// Counts stop at the cap so the backend never scans the whole table.
export function formatFeedbackCount(count: number, cap: number): string {
  return count > cap ? `${String(cap)}+` : String(count);
}

export async function loadConvexAdminFeedback(
  client: ConvexReactClient,
  status: ConvexFeedbackStatus
): Promise<ConvexAdminFeedbackPage> {
  return feedbackPageSchema.parse(
    await client.query(listReference, { status })
  );
}

export async function loadConvexAdminFeedbackCounts(
  client: ConvexReactClient
): Promise<ConvexAdminFeedbackCounts> {
  return feedbackCountsSchema.parse(await client.query(countsReference, {}));
}

export async function setConvexAdminFeedbackStatus(
  client: ConvexReactClient,
  id: string,
  status: ConvexFeedbackStatus
): Promise<ConvexAdminFeedback> {
  return feedbackSchema.parse(
    await client.mutation(setStatusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("feedback", id),
      status,
    })
  );
}

export async function deleteConvexAdminFeedback(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("feedback", id),
    })
  );
}
