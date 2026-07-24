import type { Infer } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import {
  toCatalogMovie,
  toCatalogShow,
} from "../catalog/readModel.js";
import { domainError } from "../lib/errors.js";
import { toRating } from "../ratings/readModel.js";
import { MAX_REVIEW_RELATIONSHIPS } from "./limits.js";
import type {
  assignmentReviewDetailValidator,
  extraReviewDetailValidator,
  reviewCoreValidator,
  reviewDetailValidator,
} from "./validators.js";

type ReviewReadContext = Pick<QueryCtx, "db">;
type ReviewCore = Infer<typeof reviewCoreValidator>;
type ReviewDetail = Infer<typeof reviewDetailValidator>;
type AssignmentReviewDetail = Infer<
  typeof assignmentReviewDetailValidator
>;
type ExtraReviewDetail = Infer<
  typeof extraReviewDetailValidator
>;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function toEpisode(episode: Doc<"episodes">) {
  return {
    id: episode._id,
    number: episode.number,
    title: episode.title,
    status: nullable(episode.status),
    slug: nullable(episode.slug),
  };
}

function assertRelationshipLimit<T>(
  rows: T[],
  relationship: string,
): asserts rows is T[] {
  if (rows.length > MAX_REVIEW_RELATIONSHIPS) {
    domainError(
      "CONFLICT",
      `Review ${relationship} exceed the supported read limit.`,
      {
        details: {
          relationship,
          limit: MAX_REVIEW_RELATIONSHIPS,
        },
      },
    );
  }
}

export async function hydrateReviewCore(
  ctx: ReviewReadContext,
  review: Doc<"reviews">,
): Promise<ReviewCore> {
  if ((review.movieId === undefined) === (review.showId === undefined)) {
    domainError(
      "CONFLICT",
      "Review must reference exactly one movie or show.",
      { details: { reviewId: review._id } },
    );
  }
  const [user, movie, show, rating] = await Promise.all([
    review.userId === undefined
      ? null
      : ctx.db.get("users", review.userId),
    review.movieId === undefined
      ? null
      : ctx.db.get("movies", review.movieId),
    review.showId === undefined
      ? null
      : ctx.db.get("shows", review.showId),
    review.ratingId === undefined
      ? null
      : ctx.db.get("ratings", review.ratingId),
  ]);
  if (review.userId !== undefined && user === null) {
    domainError("CONFLICT", "Review has a missing user relationship.", {
      details: { reviewId: review._id },
    });
  }
  if (review.movieId !== undefined && movie === null) {
    domainError("CONFLICT", "Review has a missing movie relationship.", {
      details: { reviewId: review._id },
    });
  }
  if (review.showId !== undefined && show === null) {
    domainError("CONFLICT", "Review has a missing show relationship.", {
      details: { reviewId: review._id },
    });
  }
  if (review.ratingId !== undefined && rating === null) {
    domainError("CONFLICT", "Review has a missing rating relationship.", {
      details: { reviewId: review._id },
    });
  }
  return {
    id: review._id,
    user:
      user === null
        ? null
        : {
            id: user._id,
            name: nullable(user.name),
            image: nullable(user.image),
            status: user.status,
          },
    movie: movie === null ? null : toCatalogMovie(movie),
    show: show === null ? null : toCatalogShow(show),
    rating: rating === null ? null : toRating(rating),
    reviewedAt: nullable(review.reviewedAt),
  };
}

export async function hydrateAssignmentReview(
  ctx: ReviewReadContext,
  link: Doc<"assignmentReviews">,
): Promise<AssignmentReviewDetail> {
  const [assignment, review] = await Promise.all([
    ctx.db.get("assignments", link.assignmentId),
    ctx.db.get("reviews", link.reviewId),
  ]);
  if (assignment === null || review === null) {
    domainError(
      "CONFLICT",
      "Assignment review has a missing canonical relationship.",
      { details: { assignmentReviewId: link._id } },
    );
  }
  const episode = await ctx.db.get(
    "episodes",
    assignment.episodeId,
  );
  if (episode === null) {
    domainError(
      "CONFLICT",
      "Assignment review has a missing episode relationship.",
      { details: { assignmentReviewId: link._id } },
    );
  }
  return {
    id: link._id,
    assignment: {
      id: assignment._id,
      type: assignment.type,
      playable: assignment.playable,
      episode: toEpisode(episode),
    },
    review: await hydrateReviewCore(ctx, review),
  };
}

export async function hydrateExtraReview(
  ctx: ReviewReadContext,
  link: Doc<"extraReviews">,
): Promise<ExtraReviewDetail> {
  const [episode, review] = await Promise.all([
    ctx.db.get("episodes", link.episodeId),
    ctx.db.get("reviews", link.reviewId),
  ]);
  if (episode === null || review === null) {
    domainError(
      "CONFLICT",
      "Extra review has a missing canonical relationship.",
      { details: { extraReviewId: link._id } },
    );
  }
  return {
    id: link._id,
    episode: toEpisode(episode),
    review: await hydrateReviewCore(ctx, review),
  };
}

export async function hydrateReviewDetail(
  ctx: ReviewReadContext,
  review: Doc<"reviews">,
): Promise<ReviewDetail> {
  const [core, assignmentReviews, extraReviews] = await Promise.all([
    hydrateReviewCore(ctx, review),
    ctx.db
      .query("assignmentReviews")
      .withIndex("by_reviewId", (index) =>
        index.eq("reviewId", review._id),
      )
      .take(MAX_REVIEW_RELATIONSHIPS + 1),
    ctx.db
      .query("extraReviews")
      .withIndex("by_reviewId", (index) =>
        index.eq("reviewId", review._id),
      )
      .take(MAX_REVIEW_RELATIONSHIPS + 1),
  ]);
  assertRelationshipLimit(
    assignmentReviews,
    "assignment relationships",
  );
  assertRelationshipLimit(extraReviews, "extra relationships");
  return {
    ...core,
    assignmentReviews: await Promise.all(
      assignmentReviews.map(async (link) => {
        const assignment = await ctx.db.get(
          "assignments",
          link.assignmentId,
        );
        if (assignment === null) {
          domainError(
            "CONFLICT",
            "Review has a missing assignment relationship.",
            { details: { assignmentReviewId: link._id } },
          );
        }
        const episode = await ctx.db.get(
          "episodes",
          assignment.episodeId,
        );
        if (episode === null) {
          domainError(
            "CONFLICT",
            "Review has a missing assignment episode.",
            { details: { assignmentReviewId: link._id } },
          );
        }
        return {
          id: link._id,
          assignment: {
            id: assignment._id,
            type: assignment.type,
            playable: assignment.playable,
            episode: toEpisode(episode),
          },
        };
      }),
    ),
    extraReviews: await Promise.all(
      extraReviews.map(async (link) => {
        const episode = await ctx.db.get(
          "episodes",
          link.episodeId,
        );
        if (episode === null) {
          domainError(
            "CONFLICT",
            "Review has a missing extra episode.",
            { details: { extraReviewId: link._id } },
          );
        }
        return {
          id: link._id,
          episode: toEpisode(episode),
        };
      }),
    ),
  };
}
