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
  validateEpisodeAudioPageSize,
} from "./limits.js";
import { hydrateAdminEpisode } from "./readModel.js";
import {
  episodeAdminAudioMessageValidator,
  episodeAdminDetailValidator,
  episodeLinkValidator,
} from "./validators.js";

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
      if (
        patch.status === "recording" ||
        patch.status === "published"
      ) {
        lockedGamblingEntries =
          await lockPendingGamblingForEpisode(ctx, episode._id);
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
