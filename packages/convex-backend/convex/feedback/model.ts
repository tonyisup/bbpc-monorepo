import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";

export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000;
export const MAX_FEEDBACK_PAGE_PATH_LENGTH = 300;
export const FEEDBACK_RATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_FEEDBACK_PER_WINDOW = 5;
export const MAX_ADMIN_FEEDBACK_PAGE = 100;
export const FEEDBACK_COUNT_CAP = 99;

export type FeedbackCategory = Doc<"feedback">["category"];
export type FeedbackStatus = Doc<"feedback">["status"];

export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = [
  "new",
  "reviewed",
  "archived",
];

// NFC, not NFKC, so symbols such as ™ and emoji survive as written.
export function validateFeedbackMessage(value: string): string {
  const message = value.trim().normalize("NFC");
  if (message.length < 1 || message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Feedback must contain 1 through ${String(MAX_FEEDBACK_MESSAGE_LENGTH)} characters.`,
    );
  }
  return message;
}

// A site-relative path only: the page the listener was on, never a full URL.
export function validateFeedbackPagePath(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const path = value.trim();
  if (
    path.length < 1 ||
    path.length > MAX_FEEDBACK_PAGE_PATH_LENGTH ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\s\\]/.test(path)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "The page must be a site path such as /history.",
    );
  }
  return path;
}

export async function assertFeedbackRateLimit(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  now: number,
): Promise<void> {
  const recent = await ctx.db
    .query("feedback")
    .withIndex("by_submittedByUserId_and_createdAt", (index) =>
      index
        .eq("submittedByUserId", userId)
        .gt("createdAt", now - FEEDBACK_RATE_WINDOW_MS),
    )
    .take(MAX_FEEDBACK_PER_WINDOW);
  if (recent.length >= MAX_FEEDBACK_PER_WINDOW) {
    domainError(
      "CONFLICT",
      "You have sent a lot of feedback recently. Try again later.",
      {
        retryable: true,
        details: { limit: MAX_FEEDBACK_PER_WINDOW },
      },
    );
  }
}

export async function requireFeedback(
  ctx: Pick<QueryCtx, "db">,
  id: Id<"feedback">,
): Promise<Doc<"feedback">> {
  const feedback = await ctx.db.get("feedback", id);
  if (feedback === null) {
    domainError("NOT_FOUND", "The feedback was not found.");
  }
  return feedback;
}

export async function toAdminFeedback(
  ctx: Pick<QueryCtx, "db">,
  feedback: Doc<"feedback">,
) {
  const submitter = await ctx.db.get("users", feedback.submittedByUserId);
  return {
    id: feedback._id,
    category: feedback.category,
    message: feedback.message,
    pagePath: feedback.pagePath ?? null,
    status: feedback.status,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    submitter:
      submitter === null
        ? null
        : {
            id: submitter._id,
            name: submitter.name ?? null,
            email: submitter.email ?? null,
          },
  };
}

export async function countFeedbackWithStatus(
  ctx: Pick<QueryCtx, "db">,
  status: FeedbackStatus,
): Promise<number> {
  const rows = await ctx.db
    .query("feedback")
    .withIndex("by_status_and_createdAt", (index) =>
      index.eq("status", status),
    )
    .take(FEEDBACK_COUNT_CAP + 1);
  return Math.min(rows.length, FEEDBACK_COUNT_CAP + 1);
}
