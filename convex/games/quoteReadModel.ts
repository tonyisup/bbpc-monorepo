import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_QUOTE_SUBMISSIONS_PER_EPISODE,
} from "./limits.js";
import type {
  quoteAdminSubmissionValidator,
  quoteEpisodeValidator,
  quoteMemberSubmissionValidator,
} from "./validators.js";

type QuoteReadContext = Pick<QueryCtx, "db">;
type QuoteEpisode = Infer<typeof quoteEpisodeValidator>;
type QuoteMemberSubmission = Infer<
  typeof quoteMemberSubmissionValidator
>;
type QuoteAdminSubmission = Infer<
  typeof quoteAdminSubmissionValidator
>;

export function toQuoteEpisode(
  episode: Doc<"episodes">,
): QuoteEpisode {
  return {
    id: episode._id,
    number: episode.number,
    title: episode.title,
    status: episode.status ?? null,
  };
}

export function toMemberQuoteSubmission(
  submission: Doc<"quoteSubmissions">,
): QuoteMemberSubmission {
  return {
    id: submission._id,
    quoteText: submission.quoteText,
    sourceTitle: submission.sourceTitle,
    sourceType: submission.sourceType,
    clipUrl: submission.clipUrl ?? null,
    clipStartSeconds: submission.clipStartSeconds ?? null,
    listenerNotes: submission.listenerNotes ?? null,
    status: submission.status,
    bracketOrder: submission.bracketOrder ?? null,
    placement: submission.placement ?? null,
    scored: submission.pointId !== undefined,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

export async function requireQuoteSubmission(
  ctx: QuoteReadContext,
  id: Id<"quoteSubmissions">,
): Promise<Doc<"quoteSubmissions">> {
  const submission = await ctx.db.get("quoteSubmissions", id);
  if (submission === null) {
    domainError("NOT_FOUND", "The quote submission is unavailable.");
  }
  return submission;
}

export async function requireQuoteEpisode(
  ctx: QuoteReadContext,
  id: Id<"episodes">,
): Promise<Doc<"episodes">> {
  const episode = await ctx.db.get("episodes", id);
  if (episode === null) {
    domainError("NOT_FOUND", "The quote episode is unavailable.");
  }
  return episode;
}

export async function findQuoteForEpisodeUser(
  ctx: QuoteReadContext,
  episodeId: Id<"episodes">,
  userId: Id<"users">,
): Promise<Doc<"quoteSubmissions"> | null> {
  return await ctx.db
    .query("quoteSubmissions")
    .withIndex("by_episodeId_and_userId", (index) =>
      index.eq("episodeId", episodeId).eq("userId", userId),
    )
    .unique();
}

export async function findSubmissionEpisode(
  ctx: QuoteReadContext,
  statuses: readonly ["next", "recording"] | readonly ["next"],
): Promise<Doc<"episodes"> | null> {
  const candidates = await Promise.all(
    statuses.map(async (status) => {
      return await ctx.db
        .query("episodes")
        .withIndex("by_status_and_number", (index) =>
          index.eq("status", status),
        )
        .order("desc")
        .first();
    }),
  );
  let selected: Doc<"episodes"> | null = null;
  for (const candidate of candidates) {
    if (
      candidate !== null &&
      (selected === null || candidate.number > selected.number)
    ) {
      selected = candidate;
    }
  }
  return selected;
}

export async function listQuoteSubmissionsForEpisode(
  ctx: QuoteReadContext,
  episodeId: Id<"episodes">,
): Promise<Array<Doc<"quoteSubmissions">>> {
  const submissions = await ctx.db
    .query("quoteSubmissions")
    .withIndex(
      "by_episodeId_and_bracketOrder_and_createdAt",
      (index) => index.eq("episodeId", episodeId),
    )
    .take(MAX_QUOTE_SUBMISSIONS_PER_EPISODE + 1);
  if (submissions.length > MAX_QUOTE_SUBMISSIONS_PER_EPISODE) {
    domainError(
      "CONFLICT",
      "Quote submissions exceed the supported episode limit.",
      { details: { limit: MAX_QUOTE_SUBMISSIONS_PER_EPISODE } },
    );
  }
  return submissions;
}

export async function hydrateAdminQuoteSubmission(
  ctx: QueryCtx,
  submission: Doc<"quoteSubmissions">,
): Promise<QuoteAdminSubmission> {
  const [user, episode, season, point] = await Promise.all([
    ctx.db.get("users", submission.userId),
    ctx.db.get("episodes", submission.episodeId),
    ctx.db.get("seasons", submission.seasonId),
    submission.pointId === undefined
      ? null
      : ctx.db.get("points", submission.pointId),
  ]);
  if (user === null || episode === null || season === null) {
    domainError(
      "CONFLICT",
      "Quote submission has a missing canonical relationship.",
      { details: { quoteSubmissionId: submission._id } },
    );
  }
  if (submission.pointId !== undefined) {
    if (point === null) {
      domainError(
        "CONFLICT",
        "Quote submission has a missing award point.",
        { details: { quoteSubmissionId: submission._id } },
      );
    }
    if (
      point.userId !== submission.userId ||
      point.seasonId !== submission.seasonId
    ) {
      domainError(
        "CONFLICT",
        "Quote award point belongs to a different user or season.",
        { details: { quoteSubmissionId: submission._id } },
      );
    }
  }
  return {
    ...toMemberQuoteSubmission(submission),
    userId: user._id,
    episodeId: episode._id,
    seasonId: season._id,
    adminNotes: submission.adminNotes ?? null,
    user: {
      id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
    },
    episode: toQuoteEpisode(episode),
    season: { id: season._id, title: season.title },
    point:
      point === null
        ? null
        : {
            id: point._id,
            adjustment: point.adjustment,
            reason: point.reason ?? null,
          },
  };
}
