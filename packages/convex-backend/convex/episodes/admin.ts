import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import { internal } from "../_generated/api.js";
import { BBPC_API_VERSION } from "../../contracts/index.js";
import { adminMutation, adminQuery, internalAppMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { buildMergePreview } from "./mergeModel.js";
import {
  enqueueUploadThingDelete,
  findUploadThingDeleteIntent,
} from "../sideEffects/intents.js";
import {
  allocateEpisodeSlug,
  assertEpisodeLinkCapacity,
  episodeShortTextLimit,
  lockPendingGamblingForEpisode,
  requireEpisode,
  validateAudioNotes,
  validateEpisodeDateRange,
  validateEpisodeNumber,
  validateEpisodeStatus,
  validateEpisodeTitle,
  validateFileKey,
  validateHttpUrl,
  validateLinkText,
  validateOptionalEpisodeText,
  validatePlainDate,
} from "./adminWriteModel.js";
import {
  MAX_AUDIO_MESSAGES_PER_USER_EPISODE,
  MAX_GAMBLING_ENTRIES_PER_EPISODE_UPDATE,
  validateEpisodeAudioPageSize,
  validateEpisodePageSize,
} from "./limits.js";
import { hydrateAdminEpisode } from "./readModel.js";
import {
  episodeAdminAudioMessageValidator,
  episodeAdminDetailValidator,
  episodeLinkValidator,
} from "./validators.js";

const PREDICTION_GRACE_PERIOD_MS = 10 * 60 * 1000;

export const closePredictionWindow = internalAppMutation({
  args: { episodeId: v.id("episodes"), closesAt: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const episode = await ctx.db.get("episodes", args.episodeId);
    // A stale job must not lock wagers after an administrator reopens the round.
    if (
      episode?.status !== "recording" ||
      episode.predictionClosesAt !== args.closesAt ||
      Date.now() < args.closesAt
    ) return 0;
    const locked = await lockPendingGamblingForEpisode(ctx, episode._id, true);
    if (locked > 0) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "episodes.predictions.closed",
        targetType: "episode",
        targetId: episode._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: { closesAt: args.closesAt, lockedGamblingEntries: locked },
      });
    }
    if (locked === MAX_GAMBLING_ENTRIES_PER_EPISODE_UPDATE) {
      await ctx.scheduler.runAfter(
        0,
        internal.episodes.admin.closePredictionWindow,
        {
          ...args,
          cutoverRunId: ctx.systemState.cutoverRunId,
          clientApiVersion: BBPC_API_VERSION,
        },
      );
    }
    return locked;
  },
});

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function toAdminUser(user: Doc<"users">) {
  return {
    id: user._id,
    name: nullable(user.name),
    email: nullable(user.email),
    image: nullable(user.image),
    status: user.status,
  };
}

function assertEpisodeSnapshot(
  episode: Doc<"episodes">,
  expected: {
    number: number;
    title: string;
    recording: string | null;
    date: string | null;
    description: string | null;
    status: string | null;
    notes: string | null;
    seoDescription: string | null;
    seoKeywords: string | null;
    seoTitle: string | null;
    slug: string | null;
  },
): void {
  if (
    episode.number !== expected.number ||
    episode.title !== expected.title ||
    nullable(episode.recording) !== expected.recording ||
    nullable(episode.date) !== expected.date ||
    nullable(episode.description) !== expected.description ||
    nullable(episode.status) !== expected.status ||
    nullable(episode.notes) !== expected.notes ||
    nullable(episode.seoDescription) !== expected.seoDescription ||
    nullable(episode.seoKeywords) !== expected.seoKeywords ||
    nullable(episode.seoTitle) !== expected.seoTitle ||
    nullable(episode.slug) !== expected.slug
  ) {
    domainError(
      "CONFLICT",
      "The episode changed after it was loaded. Refresh before saving.",
    );
  }
}

async function hydrateAdminAudioMessage(
  ctx: Parameters<typeof hydrateAdminEpisode>[0],
  message: Doc<"episodeAudioMessages">,
) {
  const user = await ctx.db.get("users", message.userId);
  if (user === null) {
    domainError(
      "CONFLICT",
      "Episode audio administration found a missing user.",
      { details: { audioMessageId: message._id } },
    );
  }
  return {
    id: message._id,
    url: message.url,
    createdAt: message.createdAt,
    fileKey: nullable(message.fileKey),
    episodeId: nullable(message.episodeId),
    notes: nullable(message.notes),
    user: toAdminUser(user),
  };
}

export const getById = adminQuery({
  args: { id: v.id("episodes") },
  returns: v.union(episodeAdminDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const episode = await ctx.db.get("episodes", args.id);
    return episode === null
      ? null
      : await hydrateAdminEpisode(ctx, episode);
  },
});

export const getByNumber = adminQuery({
  args: { number: v.number() },
  returns: v.union(episodeAdminDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const number = validateEpisodeNumber(args.number);
    const episode = await ctx.db
      .query("episodes")
      .withIndex("by_number", (index) =>
        index.eq("number", number),
      )
      .first();
    return episode === null
      ? null
      : await hydrateAdminEpisode(ctx, episode);
  },
});

export const listPage = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
    sortBy: v.optional(v.union(v.literal("number"), v.literal("date"))),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: paginationResultValidator(episodeAdminDetailValidator),
  handler: async (ctx, args) => {
    validateEpisodePageSize(args.paginationOpts.numItems);
    validateEpisodeDateRange(args);
    const hasDateRange = args.dateFrom !== undefined || args.dateTo !== undefined;
    // Keep the existing ordering for callers that do not request a sort.
    const sortBy = args.sortBy ?? (hasDateRange ? "date" : "number");
    let episodes =
      sortBy === "date"
        ? ctx.db.query("episodes").withIndex("by_date_and_status", (index) => {
            if (!hasDateRange) return index;
            // A lower bound also excludes episodes without a date in an end-only range.
            const range = index.gte("date", args.dateFrom ?? "0000-01-01");
            return args.dateTo ? range.lte("date", args.dateTo) : range;
          })
        : ctx.db.query("episodes").withIndex("by_number");
    if (sortBy === "number" && hasDateRange) {
      // convex-query-audit: allow-filter Date bounds cannot use the number index; filter before pagination to retain global number ordering.
      episodes = episodes.filter((filter) => {
        const from = filter.gte(
          filter.field("date"),
          args.dateFrom ?? "0000-01-01",
        );
        return args.dateTo
          ? filter.and(from, filter.lte(filter.field("date"), args.dateTo))
          : from;
      });
    }
    const result = await episodes
      .order(args.sortDirection ?? "desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((episode) => hydrateAdminEpisode(ctx, episode)),
      ),
    };
  },
});

export const listAudioMessages = adminQuery({
  args: {
    episodeId: v.id("episodes"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    episodeAdminAudioMessageValidator,
  ),
  handler: async (ctx, args) => {
    validateEpisodeAudioPageSize(args.paginationOpts.numItems);
    const episode = await ctx.db.get("episodes", args.episodeId);
    if (episode === null) {
      domainError("NOT_FOUND", "The episode is unavailable.");
    }
    const result = await ctx.db
      .query("episodeAudioMessages")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", episode._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((message) =>
          hydrateAdminAudioMessage(ctx, message),
        ),
      ),
    };
  },
});

export const createEpisode = adminMutation({
  args: {
    number: v.number(),
    title: v.string(),
  },
  returns: episodeAdminDetailValidator,
  handler: async (ctx, args) => {
    const number = validateEpisodeNumber(args.number);
    const title = validateEpisodeTitle(args.title);
    const slug = await allocateEpisodeSlug(ctx, { number, title });
    const episodeId = await ctx.db.insert("episodes", {
      number,
      title,
      status: "pending",
      ...slug,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.created",
      targetType: "episode",
      targetId: episodeId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { number },
    });
    const episode = await requireEpisode(ctx, episodeId);
    return await hydrateAdminEpisode(ctx, episode);
  },
});

/** Export the preview/backup privately before requesting a destructive commit. */
export const previewDuplicateMerge = adminQuery({
  args: { keeperId: v.id("episodes"), donorId: v.id("episodes") },
  returns: v.object({ fingerprint: v.string(), snapshotJson: v.string(), slug: v.string() }),
  handler: async (ctx, args) => {
    const plan = await buildMergePreview(ctx, args.keeperId, args.donorId);
    return { fingerprint: plan.fingerprint, snapshotJson: plan.snapshotJson, slug: plan.slug };
  },
});

/** One pair per transaction; no redirect or alias is created. */
export const mergeDuplicateEpisode = adminMutation({
  args: {
    keeperId: v.id("episodes"), donorId: v.id("episodes"),
    expectedFingerprint: v.string(), backupReceipt: v.string(),
    confirmation: v.literal("MERGE_WITHOUT_REDIRECTS_AND_REBUILD_SLUG"),
  },
  returns: v.object({ keeperId: v.id("episodes"), removedId: v.id("episodes"), slug: v.string() }),
  handler: async (ctx, args) => {
    if (!args.backupReceipt.trim() || args.backupReceipt.length > 512) domainError("VALIDATION_FAILED", "A private backup receipt is required.");
    const plan = await buildMergePreview(ctx, args.keeperId, args.donorId);
    if (plan.fingerprint !== args.expectedFingerprint) domainError("CONFLICT", "Merge data changed. Preview and back up again.");
    for (const table of ["archivePosts", "assignments", "extraReviews", "episodeLinks"] as const) {
      for (const row of plan.donorRelations[table]) await ctx.db.patch(table, row._id, { episodeId: args.keeperId });
    }
    // Release the base slug first. Deletion, regeneration and all child moves are atomic.
    await ctx.db.delete("episodes", args.donorId);
    await ctx.db.patch("episodes", args.keeperId, { ...plan.patch, slug: undefined, normalizedSlug: undefined });
    const slug = await allocateEpisodeSlug(ctx, { number: plan.keeper.number, title: plan.keeper.title, excludeId: args.keeperId });
    if (slug.slug !== plan.slug) domainError("CONFLICT", "Expected unsuffixed slug was unavailable.");
    await ctx.db.patch("episodes", args.keeperId, slug);
    await writeAuditEvent(ctx, {
      actor: ctx.actor, action: "episodes.admin.duplicateMerged", targetType: "episode", targetId: args.keeperId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { donorId: args.donorId, donorSnapshot: JSON.stringify(plan.donor), fingerprint: plan.fingerprint, backupReceipt: args.backupReceipt, slug: slug.slug, redirects: false },
    });
    return { keeperId: args.keeperId, removedId: args.donorId, slug: slug.slug };
  },
});

export const updateEpisode = adminMutation({
  args: {
    id: v.id("episodes"),
    number: v.optional(v.number()),
    title: v.optional(v.string()),
    recording: v.optional(v.union(v.string(), v.null())),
    date: v.optional(v.union(v.string(), v.null())),
    description: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.string()),
    notes: v.optional(v.union(v.string(), v.null())),
    seoDescription: v.optional(v.union(v.string(), v.null())),
    seoKeywords: v.optional(v.union(v.string(), v.null())),
    seoTitle: v.optional(v.union(v.string(), v.null())),
    slug: v.optional(v.union(v.string(), v.null())),
    expected: v.optional(
      v.object({
        number: v.number(),
        title: v.string(),
        recording: v.union(v.string(), v.null()),
        date: v.union(v.string(), v.null()),
        description: v.union(v.string(), v.null()),
        status: v.union(v.string(), v.null()),
        notes: v.union(v.string(), v.null()),
        seoDescription: v.union(v.string(), v.null()),
        seoKeywords: v.union(v.string(), v.null()),
        seoTitle: v.union(v.string(), v.null()),
        slug: v.union(v.string(), v.null()),
      }),
    ),
  },
  returns: episodeAdminDetailValidator,
  handler: async (ctx, args) => {
    const episode = await requireEpisode(ctx, args.id);
    if (args.expected !== undefined) {
      assertEpisodeSnapshot(episode, args.expected);
    }
    const patch: {
      number?: number;
      title?: string;
      recording?: string | undefined;
      date?: string | undefined;
      description?: string | undefined;
      status?: string;
      predictionClosesAt?: number | undefined;
      notes?: string | undefined;
      seoDescription?: string | undefined;
      seoKeywords?: string | undefined;
      seoTitle?: string | undefined;
      slug?: string;
      normalizedSlug?: string;
    } = {};
    if (args.number !== undefined) {
      patch.number = validateEpisodeNumber(args.number);
    }
    if (args.title !== undefined) {
      patch.title = validateEpisodeTitle(args.title);
    }
    if (args.recording !== undefined) {
      patch.recording = validateOptionalEpisodeText(
        args.recording,
        "Episode recording",
        2048,
      );
    }
    if (args.date !== undefined) {
      patch.date = validatePlainDate(args.date);
    }
    if (args.description !== undefined) {
      patch.description = validateOptionalEpisodeText(
        args.description,
        "Episode description",
      );
    }
    if (args.notes !== undefined) {
      patch.notes = validateOptionalEpisodeText(
        args.notes,
        "Episode notes",
      );
    }
    if (args.seoDescription !== undefined) {
      patch.seoDescription = validateOptionalEpisodeText(
        args.seoDescription,
        "SEO description",
        episodeShortTextLimit,
      );
    }
    if (args.seoKeywords !== undefined) {
      patch.seoKeywords = validateOptionalEpisodeText(
        args.seoKeywords,
        "SEO keywords",
        episodeShortTextLimit,
      );
    }
    if (args.seoTitle !== undefined) {
      patch.seoTitle = validateOptionalEpisodeText(
        args.seoTitle,
        "SEO title",
        episodeShortTextLimit,
      );
    }

    let lockedGamblingEntries = 0;
    if (args.status !== undefined) {
      patch.status = validateEpisodeStatus(args.status);
      if (patch.status === "recording" && episode.status !== "recording") {
        patch.predictionClosesAt = Date.now() + PREDICTION_GRACE_PERIOD_MS;
        await ctx.scheduler.runAt(
          patch.predictionClosesAt,
          internal.episodes.admin.closePredictionWindow,
          {
            episodeId: episode._id,
            closesAt: patch.predictionClosesAt,
            cutoverRunId: ctx.systemState.cutoverRunId,
            clientApiVersion: BBPC_API_VERSION,
          },
        );
      } else if (patch.status === "published") {
        patch.predictionClosesAt = undefined;
        lockedGamblingEntries =
          await lockPendingGamblingForEpisode(ctx, episode._id);
      } else if (patch.status !== "recording") {
        patch.predictionClosesAt = undefined;
      }
    }

    if (args.slug !== undefined) {
      const slug = await allocateEpisodeSlug(ctx, {
        number: patch.number ?? episode.number,
        title: patch.title ?? episode.title,
        ...(args.slug === null
          ? {}
          : { requestedSlug: args.slug }),
        excludeId: episode._id,
      });
      patch.slug = slug.slug;
      patch.normalizedSlug = slug.normalizedSlug;
    }

    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return await hydrateAdminEpisode(ctx, episode);
    }
    await ctx.db.patch("episodes", episode._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.updated",
      targetType: "episode",
      targetId: episode._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        fieldCount,
        lockedGamblingEntries,
      },
    });
    const updatedEpisode = await requireEpisode(ctx, episode._id);
    return await hydrateAdminEpisode(ctx, updatedEpisode);
  },
});

export const addLink = adminMutation({
  args: {
    episodeId: v.id("episodes"),
    url: v.string(),
    text: v.string(),
  },
  returns: episodeLinkValidator,
  handler: async (ctx, args) => {
    const [episode, url, text] = await Promise.all([
      requireEpisode(ctx, args.episodeId),
      Promise.resolve(validateHttpUrl(args.url, "Link URL")),
      Promise.resolve(validateLinkText(args.text)),
    ]);
    await assertEpisodeLinkCapacity(ctx, episode._id);
    const linkId = await ctx.db.insert("episodeLinks", {
      episodeId: episode._id,
      url,
      text,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.linkAdded",
      targetType: "episodeLink",
      targetId: linkId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { episodeId: episode._id },
    });
    return { id: linkId, url, text };
  },
});

export const removeLink = adminMutation({
  args: {
    id: v.id("episodeLinks"),
    expected: v.optional(
      v.object({
        episodeId: v.union(v.id("episodes"), v.null()),
        url: v.string(),
        text: v.string(),
      }),
    ),
  },
  returns: v.object({ id: v.id("episodeLinks") }),
  handler: async (ctx, args) => {
    const link = await ctx.db.get("episodeLinks", args.id);
    if (link === null) {
      domainError("NOT_FOUND", "The episode link is unavailable.");
    }
    if (
      args.expected !== undefined &&
      (nullable(link.episodeId) !== args.expected.episodeId ||
        link.url !== args.expected.url ||
        link.text !== args.expected.text)
    ) {
      domainError(
        "CONFLICT",
        "The episode link changed after it was loaded.",
      );
    }
    await ctx.db.delete("episodeLinks", link._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.linkRemoved",
      targetType: "episodeLink",
      targetId: link._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      ...(link.episodeId === undefined
        ? {}
        : { metadata: { episodeId: link.episodeId } }),
    });
    return { id: link._id };
  },
});

export const addAudioMessage = adminMutation({
  args: {
    episodeId: v.id("episodes"),
    url: v.string(),
    fileKey: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: episodeAdminAudioMessageValidator,
  handler: async (ctx, args) => {
    const episode = await requireEpisode(ctx, args.episodeId);
    const url = validateHttpUrl(args.url, "Audio URL");
    const fileKey = validateFileKey(args.fileKey);
    const notes = validateAudioNotes(args.notes);
    const existing = await ctx.db
      .query("episodeAudioMessages")
      .withIndex(
        "by_userId_and_episodeId_and_createdAt",
        (index) =>
          index
            .eq("userId", ctx.actor.user._id)
            .eq("episodeId", episode._id),
      )
      .take(MAX_AUDIO_MESSAGES_PER_USER_EPISODE);
    if (
      existing.length >= MAX_AUDIO_MESSAGES_PER_USER_EPISODE
    ) {
      domainError(
        "CONFLICT",
        "The administrator has reached the per-episode audio-message limit.",
        {
          details: {
            limit: MAX_AUDIO_MESSAGES_PER_USER_EPISODE,
          },
        },
      );
    }
    const createdAt = Date.now();
    const messageId = await ctx.db.insert(
      "episodeAudioMessages",
      {
        episodeId: episode._id,
        userId: ctx.actor.user._id,
        url,
        createdAt,
        ...(fileKey === undefined ? {} : { fileKey }),
        ...(notes === undefined ? {} : { notes }),
      },
    );
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.audioMessageAdded",
      targetType: "episodeAudioMessage",
      targetId: messageId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { episodeId: episode._id },
    });
    return {
      id: messageId,
      url,
      createdAt,
      fileKey: nullable(fileKey),
      episodeId: episode._id,
      notes: nullable(notes),
      user: toAdminUser(ctx.actor.user),
    };
  },
});

export const removeAudioMessage = adminMutation({
  args: {
    id: v.id("episodeAudioMessages"),
    expected: v.object({
      episodeId: v.union(v.id("episodes"), v.null()),
      url: v.string(),
      fileKey: v.union(v.string(), v.null()),
      createdAt: v.number(),
    }),
  },
  returns: v.object({ id: v.id("episodeAudioMessages") }),
  handler: async (ctx, args) => {
    const existingIntent = await findUploadThingDeleteIntent(
      ctx,
      {
        resourceType: "episodeAudioMessage",
        resourceId: args.id,
      },
    );
    if (existingIntent !== null) {
      return { id: args.id };
    }
    const message = await ctx.db.get(
      "episodeAudioMessages",
      args.id,
    );
    if (message === null) {
      domainError(
        "NOT_FOUND",
        "The episode audio message is unavailable.",
      );
    }
    if (
      nullable(message.episodeId) !== args.expected.episodeId ||
      message.url !== args.expected.url ||
      nullable(message.fileKey) !== args.expected.fileKey ||
      message.createdAt !== args.expected.createdAt
    ) {
      domainError(
        "CONFLICT",
        "The episode audio message changed after it was loaded.",
      );
    }
    const cleanup =
      message.fileKey === undefined
        ? null
        : await enqueueUploadThingDelete(ctx, {
            resourceType: "episodeAudioMessage",
            resourceId: message._id,
            providerKey: message.fileKey,
            requestedByUserId:
              ctx.actor.authenticatedUser._id,
            effectiveUserId: message.userId,
            cutoverRunId: ctx.systemState.cutoverRunId,
            clientApiVersion: ctx.systemState.apiVersion,
          });
    await ctx.db.delete("episodeAudioMessages", message._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.audioMessageRemoved",
      targetType: "episodeAudioMessage",
      targetId: message._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      ...(message.episodeId === undefined &&
      cleanup === null
        ? {}
        : {
            metadata: {
              ...(message.episodeId === undefined
                ? {}
                : { episodeId: message.episodeId }),
              ...(cleanup === null
                ? {}
                : {
                    sideEffectIntentId:
                      cleanup.intent._id,
                  }),
            },
          }),
    });
    return { id: message._id };
  },
});
