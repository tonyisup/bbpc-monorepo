import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_TAG_CATALOG_SIZE,
  validateTagVotePageSize,
} from "./limits.js";
import {
  hydrateTagVote,
  requireTag,
  requireTagVote,
  toTag,
} from "./tagReadModel.js";
import {
  assertTagNameAvailable,
  buildTagVotePointReason,
  countTagCatalog,
  createTag,
  validateTagDescription,
  validateTagName,
  validateTagVoteTmdbId,
} from "./tagWriteModel.js";
import {
  insertPoint,
  requirePointUser,
  resolveGamePointTypeByLookup,
  resolvePointSeason,
  validateEarnedAt,
  validatePointReason,
} from "./pointWriteModel.js";
import {
  tagValidator,
  tagVoteValidator,
} from "./validators.js";

async function hydrateVotes(
  ctx: Parameters<typeof hydrateTagVote>[0],
  votes: Array<Doc<"tagVotes">>,
) {
  return await Promise.all(
    votes.map((vote) => hydrateTagVote(ctx, vote)),
  );
}

export const listCatalog = adminQuery({
  args: {},
  returns: v.array(tagValidator),
  handler: async (ctx) => {
    const tags = await ctx.db
      .query("tags")
      .withIndex("by_normalizedName")
      .take(MAX_TAG_CATALOG_SIZE + 1);
    if (tags.length > MAX_TAG_CATALOG_SIZE) {
      domainError(
        "CONFLICT",
        "The tag catalog exceeds the administrator read limit.",
        { details: { limit: MAX_TAG_CATALOG_SIZE } },
      );
    }
    return tags.map(toTag);
  },
});

export const createCatalogTag = adminMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: tagValidator,
  handler: async (ctx, args) => {
    const name = validateTagName(args.name);
    const description =
      args.description === undefined
        ? undefined
        : validateTagDescription(args.description);
    await assertTagNameAvailable(ctx, name.normalizedName);
    if (
      (await countTagCatalog(ctx, MAX_TAG_CATALOG_SIZE)) >=
      MAX_TAG_CATALOG_SIZE
    ) {
      domainError(
        "CONFLICT",
        "The tag catalog is at capacity.",
        { details: { limit: MAX_TAG_CATALOG_SIZE } },
      );
    }
    const createdAt = validateEarnedAt(args.createdAt ?? Date.now());
    const tag = await createTag(ctx, {
      ...name,
      ...(description === undefined ? {} : { description }),
      createdAt,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.tagCreated",
      targetType: "tag",
      targetId: tag._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toTag(tag);
  },
});

export const updateCatalogTag = adminMutation({
  args: {
    id: v.id("tags"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
  },
  returns: tagValidator,
  handler: async (ctx, args) => {
    const tag = await requireTag(ctx, args.id);
    const patch: {
      name?: string;
      normalizedName?: string;
      description?: string | undefined;
    } = {};
    if (args.name !== undefined) {
      const name = validateTagName(args.name);
      await assertTagNameAvailable(
        ctx,
        name.normalizedName,
        tag._id,
      );
      patch.name = name.name;
      patch.normalizedName = name.normalizedName;
    }
    if (args.description !== undefined) {
      patch.description = validateTagDescription(args.description);
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return toTag(tag);
    }
    await ctx.db.patch("tags", tag._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.tagUpdated",
      targetType: "tag",
      targetId: tag._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return toTag(await requireTag(ctx, tag._id));
  },
});

export const deleteCatalogTag = adminMutation({
  args: { id: v.id("tags") },
  returns: v.object({ id: v.id("tags") }),
  handler: async (ctx, args) => {
    const tag = await requireTag(ctx, args.id);
    await ctx.db.delete("tags", tag._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.tagDeleted",
      targetType: "tag",
      targetId: tag._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: tag._id };
  },
});

export const getVoteById = adminQuery({
  args: { id: v.id("tagVotes") },
  returns: v.union(tagVoteValidator, v.null()),
  handler: async (ctx, args) => {
    const vote = await ctx.db.get("tagVotes", args.id);
    return vote === null ? null : await hydrateTagVote(ctx, vote);
  },
});

export const listVotesPage = adminQuery({
  args: {
    tmdbId: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(tagVoteValidator),
  handler: async (ctx, args) => {
    validateTagVotePageSize(args.paginationOpts.numItems);
    const tmdbId =
      args.tmdbId === undefined
        ? undefined
        : validateTagVoteTmdbId(args.tmdbId);
    const result =
      tmdbId === undefined
        ? await ctx.db
            .query("tagVotes")
            .withIndex("by_createdAt")
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("tagVotes")
            .withIndex("by_tmdbId_and_createdAt", (index) =>
              index.eq("tmdbId", tmdbId),
            )
            .order("desc")
            .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateVotes(ctx, result.page),
    };
  },
});

export const listVotesForUserPage = adminQuery({
  args: {
    userId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(tagVoteValidator),
  handler: async (ctx, args) => {
    validateTagVotePageSize(args.paginationOpts.numItems);
    await requirePointUser(ctx, args.userId);
    const result = await ctx.db
      .query("tagVotes")
      .withIndex("by_userId_and_createdAt", (index) =>
        index.eq("userId", args.userId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateVotes(ctx, result.page),
    };
  },
});

export const applyVotePoints = adminMutation({
  args: {
    id: v.id("tagVotes"),
    today: v.string(),
    earnedAt: v.optional(v.number()),
  },
  returns: tagVoteValidator,
  handler: async (ctx, args) => {
    const vote = await requireTagVote(ctx, args.id);
    if (vote.award.kind !== "unawarded") {
      domainError(
        "CONFLICT",
        "The tag vote already has historical or live award evidence.",
        { details: { awardKind: vote.award.kind } },
      );
    }
    if (vote.userId === undefined) {
      domainError(
        "CONFLICT",
        "The tag vote cannot be awarded without a user.",
      );
    }
    const [user, season, pointType] = await Promise.all([
      requirePointUser(ctx, vote.userId),
      resolvePointSeason(ctx, {
        kind: "current",
        today: args.today,
      }),
      resolveGamePointTypeByLookup(ctx, "tag-vote"),
    ]);
    const point = await insertPoint(ctx, {
      userId: user._id,
      seasonId: season._id,
      reason: validatePointReason(
        buildTagVotePointReason(vote),
      ),
      adjustment: 0,
      gamePointTypeId: pointType._id,
      earnedAt: validateEarnedAt(args.earnedAt ?? Date.now()),
    });
    await ctx.db.patch("tagVotes", vote._id, {
      award: { kind: "point", pointId: point._id },
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.tagVoteAwarded",
      targetType: "tagVote",
      targetId: vote._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { pointId: point._id },
    });
    return await hydrateTagVote(
      ctx,
      await requireTagVote(ctx, vote._id),
    );
  },
});

export const deleteVote = adminMutation({
  args: { id: v.id("tagVotes") },
  returns: v.object({ id: v.id("tagVotes") }),
  handler: async (ctx, args) => {
    const vote = await requireTagVote(ctx, args.id);
    await ctx.db.delete("tagVotes", vote._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.tagVoteDeleted",
      targetType: "tagVote",
      targetId: vote._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { awardKind: vote.award.kind },
    });
    return { id: vote._id };
  },
});
