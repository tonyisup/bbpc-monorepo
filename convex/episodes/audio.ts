import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import {
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  enqueueUploadThingDelete,
  findUploadThingDeleteIntent,
  isIntentOwnedBy,
} from "../sideEffects/intents.js";
import { episodeAudioMessageValidator } from "./validators.js";
import { MAX_AUDIO_MESSAGES_PER_USER_EPISODE } from "./limits.js";

const MAX_FILE_KEY_LENGTH = 1024;
const MAX_NOTES_LENGTH = 5000;

function toAudioMessage(message: Doc<"episodeAudioMessages">) {
  return {
    id: message._id,
    url: message.url,
    createdAt: message.createdAt,
    fileKey: message.fileKey ?? null,
    episodeId: message.episodeId ?? null,
    notes: message.notes ?? null,
  };
}

function requireOwnedMessage(
  message: Doc<"episodeAudioMessages"> | null,
  ownerId: Doc<"users">["_id"],
): asserts message is Doc<"episodeAudioMessages"> {
  if (message?.userId !== ownerId) {
    domainError(
      "NOT_FOUND",
      "The audio message is unavailable.",
    );
  }
}

function validateUpdateInput(
  fileKey: string,
  notes: string | undefined,
): void {
  if (
    fileKey.trim().length === 0 ||
    fileKey.length > MAX_FILE_KEY_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `File key must contain 1 through ${String(MAX_FILE_KEY_LENGTH)} characters.`,
    );
  }
  if (notes !== undefined && notes.length > MAX_NOTES_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Notes cannot exceed ${String(MAX_NOTES_LENGTH)} characters.`,
    );
  }
}

export const listMine = authenticatedQuery({
  args: {
    episodeId: v.id("episodes"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    episodeAudioMessageValidator,
  ),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("episodeAudioMessages")
      .withIndex(
        "by_userId_and_episodeId_and_createdAt",
        (index) =>
          index
            .eq("userId", ctx.actor.user._id)
            .eq("episodeId", args.episodeId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(toAudioMessage),
    };
  },
});

export const usageForEpisode = authenticatedQuery({
  args: { episodeId: v.id("episodes") },
  returns: v.object({
    count: v.number(),
    limit: v.number(),
    canUpload: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("episodeAudioMessages")
      .withIndex(
        "by_userId_and_episodeId_and_createdAt",
        (index) =>
          index
            .eq("userId", ctx.actor.user._id)
            .eq("episodeId", args.episodeId),
      )
    .take(MAX_AUDIO_MESSAGES_PER_USER_EPISODE + 1);
    if (messages.length > MAX_AUDIO_MESSAGES_PER_USER_EPISODE) {
      domainError(
        "CONFLICT",
        "Audio-message usage exceeds the supported per-episode limit.",
        {
          details: {
            limit: MAX_AUDIO_MESSAGES_PER_USER_EPISODE,
          },
        },
      );
    }
    return {
      count: messages.length,
      limit: MAX_AUDIO_MESSAGES_PER_USER_EPISODE,
      canUpload:
        messages.length <
        MAX_AUDIO_MESSAGES_PER_USER_EPISODE,
    };
  },
});

export const updateMine = authenticatedMutation({
  args: {
    id: v.id("episodeAudioMessages"),
    episodeId: v.id("episodes"),
    fileKey: v.string(),
    notes: v.optional(v.string()),
  },
  returns: episodeAudioMessageValidator,
  handler: async (ctx, args) => {
    validateUpdateInput(args.fileKey, args.notes);
    const [message, episode] = await Promise.all([
      ctx.db.get("episodeAudioMessages", args.id),
      ctx.db.get("episodes", args.episodeId),
    ]);
    requireOwnedMessage(message, ctx.actor.user._id);
    if (episode === null) {
      domainError("NOT_FOUND", "The episode is unavailable.");
    }
    await ctx.db.patch("episodeAudioMessages", message._id, {
      episodeId: episode._id,
      fileKey: args.fileKey,
      notes: args.notes,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.audioMessage.updated",
      targetType: "episodeAudioMessage",
      targetId: message._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { episodeId: episode._id },
    });
    return {
      id: message._id,
      url: message.url,
      createdAt: message.createdAt,
      episodeId: episode._id,
      fileKey: args.fileKey,
      notes: args.notes ?? null,
    };
  },
});

export const deleteMine = authenticatedMutation({
  args: { id: v.id("episodeAudioMessages") },
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
      if (!isIntentOwnedBy(existingIntent, ctx.actor.user._id)) {
        domainError(
          "NOT_FOUND",
          "The audio message is unavailable.",
        );
      }
      return { id: args.id };
    }
    const message = await ctx.db.get(
      "episodeAudioMessages",
      args.id,
    );
    requireOwnedMessage(message, ctx.actor.user._id);
    const cleanup =
      message.fileKey === undefined
        ? null
        : await enqueueUploadThingDelete(ctx, {
            resourceType: "episodeAudioMessage",
            resourceId: message._id,
            providerKey: message.fileKey,
            requestedByUserId:
              ctx.actor.authenticatedUser._id,
            effectiveUserId: ctx.actor.user._id,
            cutoverRunId: ctx.systemState.cutoverRunId,
            clientApiVersion: ctx.systemState.apiVersion,
          });
    await ctx.db.delete("episodeAudioMessages", message._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.audioMessage.deleted",
      targetType: "episodeAudioMessage",
      targetId: message._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      ...(cleanup === null
        ? {}
        : {
            metadata: {
              sideEffectIntentId: cleanup.intent._id,
            },
          }),
    });
    return { id: message._id };
  },
});
