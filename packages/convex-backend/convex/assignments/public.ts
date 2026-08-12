import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import {
  anonymousQuery,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";
import {
  enqueueUploadThingDelete,
  findUploadThingDeleteIntent,
  isIntentOwnedBy,
} from "../sideEffects/intents.js";
import { hydrateAssignment } from "./readModel.js";
import { publicAssignmentDetailValidator } from "./validators.js";

const MAX_AUDIO_MESSAGES_PER_USER_ASSIGNMENT = 50;
const MAX_AUDIO_URL_LENGTH = 2_048;
const MAX_FILE_KEY_LENGTH = 1_024;
const MAX_UPLOAD_ID_LENGTH = 100;

const ownedAudioMessageValidator = v.object({
  id: v.id("assignmentAudioMessages"),
  url: v.string(),
  createdAt: v.number(),
  fileKey: v.union(v.string(), v.null()),
});

function toOwnedAudioMessage(message: Doc<"assignmentAudioMessages">) {
  return {
    id: message._id,
    url: message.url,
    createdAt: message.createdAt,
    fileKey: message.fileKey ?? null,
  };
}

function validateAudioUpload(input: {
  url: string;
  fileKey: string;
  createdAt: number;
}): void {
  if (!Number.isSafeInteger(input.createdAt)) {
    domainError(
      "VALIDATION_FAILED",
      "Audio-message creation time must be an integer epoch-millisecond value.",
    );
  }
  if (
    input.fileKey.trim().length === 0 ||
    input.fileKey.length > MAX_FILE_KEY_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Audio file keys must contain 1 through ${String(MAX_FILE_KEY_LENGTH)} characters.`,
    );
  }
  const url = input.url.trim();
  if (url.length < 1 || url.length > MAX_AUDIO_URL_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Audio URLs must contain 1 through ${String(MAX_AUDIO_URL_LENGTH)} characters.`,
    );
  }
  try {
    if (new URL(url).protocol !== "https:") {
      domainError("VALIDATION_FAILED", "Audio URLs must use HTTPS.");
    }
  } catch {
    domainError(
      "VALIDATION_FAILED",
      "Audio URLs must be valid HTTPS URLs.",
    );
  }
}

function validateUploadId(uploadId: string): void {
  if (
    uploadId.length < 16 ||
    uploadId.length > MAX_UPLOAD_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(uploadId)
  ) {
    domainError("VALIDATION_FAILED", "Audio upload IDs are invalid.");
  }
}

async function requireAssignment(
  ctx: { db: Parameters<typeof hydrateAssignment>[0]["db"] },
  assignmentId: Id<"assignments">,
): Promise<void> {
  if ((await ctx.db.get("assignments", assignmentId)) === null) {
    domainError("NOT_FOUND", "The assignment is unavailable.");
  }
}

async function readOwnedAssignmentAudio(
  ctx: Parameters<typeof hydrateAssignment>[0],
  userId: Id<"users">,
  assignmentId: Id<"assignments">,
) {
  const messages = await ctx.db
    .query("assignmentAudioMessages")
    .withIndex(
      "by_userId_and_assignmentId_and_createdAt",
      (index) =>
        index.eq("userId", userId).eq("assignmentId", assignmentId),
    )
    .order("desc")
    .take(MAX_AUDIO_MESSAGES_PER_USER_ASSIGNMENT + 1);
  if (messages.length > MAX_AUDIO_MESSAGES_PER_USER_ASSIGNMENT) {
    domainError(
      "CONFLICT",
      "Assignment audio-message usage exceeds the supported limit.",
      { details: { limit: MAX_AUDIO_MESSAGES_PER_USER_ASSIGNMENT } },
    );
  }
  return messages;
}

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

export const listMyAudioMessages = authenticatedQuery({
  args: { assignmentId: v.id("assignments") },
  returns: v.array(ownedAudioMessageValidator),
  handler: async (ctx, args) => {
    await requireAssignment(ctx, args.assignmentId);
    return (
      await readOwnedAssignmentAudio(
        ctx,
        ctx.actor.user._id,
        args.assignmentId,
      )
    ).map(toOwnedAudioMessage);
  },
});

export const createMyAudioMessage = authenticatedMutation({
  args: {
    assignmentId: v.id("assignments"),
    url: v.string(),
    fileKey: v.string(),
    createdAt: v.number(),
  },
  returns: ownedAudioMessageValidator,
  handler: async (ctx, args) => {
    validateAudioUpload(args);
    await requireAssignment(ctx, args.assignmentId);
    const messages = await readOwnedAssignmentAudio(
      ctx,
      ctx.actor.user._id,
      args.assignmentId,
    );
    const existing = messages.find(
      (message) => message.fileKey === args.fileKey,
    );
    if (existing !== undefined) {
      if (
        existing.url !== args.url.trim() ||
        existing.createdAt !== args.createdAt
      ) {
        domainError(
          "CONFLICT",
          "The audio upload is already linked with different metadata.",
        );
      }
      return toOwnedAudioMessage(existing);
    }
    if (messages.length >= MAX_AUDIO_MESSAGES_PER_USER_ASSIGNMENT) {
      domainError(
        "CONFLICT",
        "The assignment audio-message limit has been reached.",
        { details: { limit: MAX_AUDIO_MESSAGES_PER_USER_ASSIGNMENT } },
      );
    }
    const id = await ctx.db.insert("assignmentAudioMessages", {
      assignmentId: args.assignmentId,
      userId: ctx.actor.user._id,
      url: args.url.trim(),
      fileKey: args.fileKey,
      createdAt: args.createdAt,
    });
    const message = await ctx.db.get("assignmentAudioMessages", id);
    if (message === null) {
      domainError(
        "INTERNAL_ERROR",
        "The assignment audio message could not be created.",
      );
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.audioMessage.created",
      targetType: "assignmentAudioMessage",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { assignmentId: args.assignmentId },
    });
    return toOwnedAudioMessage(message);
  },
});

export const deleteMyAudioMessage = authenticatedMutation({
  args: { id: v.id("assignmentAudioMessages") },
  returns: v.object({ id: v.id("assignmentAudioMessages") }),
  handler: async (ctx, args) => {
    const existingIntent = await findUploadThingDeleteIntent(ctx, {
      resourceType: "assignmentAudioMessage",
      resourceId: args.id,
    });
    if (existingIntent !== null) {
      if (!isIntentOwnedBy(existingIntent, ctx.actor.user._id)) {
        domainError(
          "NOT_FOUND",
          "The assignment audio message is unavailable.",
        );
      }
      return { id: args.id };
    }
    const message = await ctx.db.get("assignmentAudioMessages", args.id);
    if (message?.userId !== ctx.actor.user._id) {
      domainError(
        "NOT_FOUND",
        "The assignment audio message is unavailable.",
      );
    }
    const cleanup =
      message.fileKey === undefined
        ? null
        : await enqueueUploadThingDelete(ctx, {
            resourceType: "assignmentAudioMessage",
            resourceId: message._id,
            providerKey: message.fileKey,
            requestedByUserId: ctx.actor.authenticatedUser._id,
            effectiveUserId: ctx.actor.user._id,
            cutoverRunId: ctx.systemState.cutoverRunId,
            clientApiVersion: ctx.systemState.apiVersion,
          });
    await ctx.db.delete("assignmentAudioMessages", message._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.audioMessage.deleted",
      targetType: "assignmentAudioMessage",
      targetId: message._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      ...(cleanup === null
        ? {}
        : { metadata: { sideEffectIntentId: cleanup.intent._id } }),
    });
    return { id: message._id };
  },
});

export const discardMyAudioUpload = authenticatedMutation({
  args: {
    assignmentId: v.id("assignments"),
    fileKey: v.string(),
    uploadId: v.string(),
  },
  returns: v.object({
    queued: v.literal(true),
    intentId: v.id("sideEffectIntents"),
  }),
  handler: async (ctx, args) => {
    validateUploadId(args.uploadId);
    validateAudioUpload({
      url: "https://example.invalid/audio",
      fileKey: args.fileKey,
      createdAt: 0,
    });
    await requireAssignment(ctx, args.assignmentId);
    const active = (
      await readOwnedAssignmentAudio(
        ctx,
        ctx.actor.user._id,
        args.assignmentId,
      )
    ).find((message) => message.fileKey === args.fileKey);
    if (active !== undefined) {
      domainError("CONFLICT", "The active audio upload cannot be discarded.");
    }
    const cleanup = await enqueueUploadThingDelete(ctx, {
      resourceType: "assignmentAudioMessage",
      resourceId: args.uploadId,
      providerKey: args.fileKey,
      requestedByUserId: ctx.actor.authenticatedUser._id,
      effectiveUserId: ctx.actor.user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      clientApiVersion: ctx.systemState.apiVersion,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.audioMessage.uploadDiscarded",
      targetType: "assignment",
      targetId: args.assignmentId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { sideEffectIntentId: cleanup.intent._id },
    });
    return { queued: true as const, intentId: cleanup.intent._id };
  },
});
