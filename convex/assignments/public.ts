import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import { anonymousQuery } from "../functions.js";
import { normalizeLookupKey } from "../lib/normalize.js";
import { hydrateAssignment } from "./readModel.js";
import { publicAssignmentDetailValidator } from "./validators.js";

async function hydratePublicAssignment(
  ctx: Parameters<typeof hydrateAssignment>[0],
  assignment: Doc<"assignments">,
) {
  const detail = await hydrateAssignment(ctx, assignment);
  return {
    id: detail.id,
    type: detail.type,
    playable: detail.playable,
    slug: detail.slug,
    user: {
      id: detail.user.id,
      name: detail.user.name,
      image: detail.user.image,
    },
    movie: detail.movie,
    episode: detail.episode,
  };
}

export const getBySlug = anonymousQuery({
  args: { slug: v.string() },
  returns: v.union(publicAssignmentDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const normalizedSlug = normalizeLookupKey(args.slug, "Assignment slug");
    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_normalizedSlug", (query) =>
        query.eq("normalizedSlug", normalizedSlug),
      )
      .unique();
    return assignment === null
      ? null
      : await hydratePublicAssignment(ctx, assignment);
  },
});

export const getByLegacyId = anonymousQuery({
  args: { legacyId: v.string() },
  returns: v.union(publicAssignmentDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const legacyId = normalizeLookupKey(args.legacyId, "Assignment legacy ID");
    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_legacyId", (query) => query.eq("legacyId", legacyId))
      .unique();
    return assignment === null
      ? null
      : await hydratePublicAssignment(ctx, assignment);
  },
});
