import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { authenticatedMutation } from "../functions.js";
import type { UserActor } from "../lib/actors.js";
import { writeAuditEvent } from "../lib/audit.js";
import { hydrateExtraReview } from "./readModel.js";
import { extraReviewDetailValidator } from "./validators.js";
import { createReview, requireEpisode } from "./writeModel.js";

type OwnerExtraContext = MutationCtx & {
  actor: UserActor;
  systemState: Doc<"systemState">;
};

async function createOwnerExtra(
  ctx: OwnerExtraContext,
  input: {
    episodeId: Parameters<typeof requireEpisode>[1];
    movieId?: Parameters<typeof createReview>[1]["movieId"];
    showId?: Parameters<typeof createReview>[1]["showId"];
  },
) {
  const episode = await requireEpisode(ctx, input.episodeId);
  const review = await createReview(ctx, {
    userId: ctx.actor.user._id,
    ...(input.movieId === undefined
      ? {}
      : { movieId: input.movieId }),
    ...(input.showId === undefined ? {} : { showId: input.showId }),
  });
  const extraReviewId = await ctx.db.insert("extraReviews", {
    reviewId: review._id,
    episodeId: episode._id,
  });
  await writeAuditEvent(ctx, {
    actor: ctx.actor,
    action: "reviews.owner.extraCreated",
    targetType: "review",
    targetId: review._id,
    cutoverRunId: ctx.systemState.cutoverRunId,
    metadata: {
      targetType:
        input.movieId === undefined ? "show" : "movie",
    },
  });
  const link = await ctx.db.get("extraReviews", extraReviewId);
  if (link === null) {
    throw new Error("Created extra review link is unavailable.");
  }
  return await hydrateExtraReview(ctx, link);
}

export const addMovieExtra = authenticatedMutation({
  args: {
    movieId: v.id("movies"),
    episodeId: v.id("episodes"),
  },
  returns: extraReviewDetailValidator,
  handler: async (ctx, args) => {
    return await createOwnerExtra(ctx, {
      movieId: args.movieId,
      episodeId: args.episodeId,
    });
  },
});

export const addShowExtra = authenticatedMutation({
  args: {
    showId: v.id("shows"),
    episodeId: v.id("episodes"),
  },
  returns: extraReviewDetailValidator,
  handler: async (ctx, args) => {
    return await createOwnerExtra(ctx, {
      showId: args.showId,
      episodeId: args.episodeId,
    });
  },
});
