import { v } from "convex/values";

import {
  adminQuery,
  authenticatedAction,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { enqueueUploadThingDelete } from "../sideEffects/intents.js";
import { cutoverStageValidator } from "../lib/validators.js";
import { identityProfileValidator } from "./validators.js";

const MAX_PROFILE_IMAGE_URL_LENGTH = 2_048;
const MAX_PROFILE_IMAGE_UPLOAD_ID_LENGTH = 100;

function normalizeProfileName(rawName: string): string {
  const name = rawName.trim();
  if (name.length < 1 || name.length > 100) {
    domainError(
      "VALIDATION_FAILED",
      "Name must contain between 1 and 100 characters.",
    );
  }
  return name;
}

function normalizeProfileImageUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (
    url.length < 1 ||
    url.length > MAX_PROFILE_IMAGE_URL_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Profile image URLs must contain 1 through ${String(MAX_PROFILE_IMAGE_URL_LENGTH)} characters.`,
    );
  }
  try {
    if (new URL(url).protocol !== "https:") {
      domainError(
        "VALIDATION_FAILED",
        "Profile image URLs must use HTTPS.",
      );
    }
  } catch {
    domainError(
      "VALIDATION_FAILED",
      "Profile image URLs must be valid HTTPS URLs.",
    );
  }
  return url;
}

function validateProfileImageUploadId(uploadId: string): void {
  if (
    uploadId.length < 16 ||
    uploadId.length > MAX_PROFILE_IMAGE_UPLOAD_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(uploadId)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Profile image upload IDs are invalid.",
    );
  }
}

export const me = authenticatedQuery({
  args: {},
  returns: identityProfileValidator,
  handler: async (ctx) => ({
    id: ctx.actor.user._id,
    name: ctx.actor.user.name ?? null,
    email: ctx.actor.user.email ?? null,
    image: ctx.actor.user.image ?? null,
    isAdmin: ctx.actor.isAdmin,
    isHost: ctx.actor.isHost,
  }),
});

export const administratorMe = adminQuery({
  args: {},
  returns: identityProfileValidator,
  handler: async (ctx) => ({
    id: ctx.actor.authenticatedUser._id,
    name: ctx.actor.authenticatedUser.name ?? null,
    email: ctx.actor.authenticatedUser.email ?? null,
    image: ctx.actor.authenticatedUser.image ?? null,
    isAdmin: true,
    isHost: ctx.actor.isHost,
  }),
});

export const updateMyName = authenticatedMutation({
  args: { name: v.string() },
  returns: v.object({
    name: v.string(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const name = normalizeProfileName(args.name);
    const now = Date.now();
    await ctx.db.patch("users", ctx.actor.user._id, {
      name,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.profile.nameUpdated",
      targetType: "user",
      targetId: ctx.actor.user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { name, updatedAt: now };
  },
});

export const updateMyProfileWithImage = authenticatedMutation({
  args: {
    name: v.string(),
    image: v.string(),
    fileKey: v.string(),
    uploadId: v.string(),
    expectedImage: v.union(v.string(), v.null()),
  },
  returns: v.object({
    name: v.string(),
    image: v.string(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const name = normalizeProfileName(args.name);
    const image = normalizeProfileImageUrl(args.image);
    validateProfileImageUploadId(args.uploadId);
    const user = ctx.actor.user;
    if ((user.image ?? null) !== args.expectedImage) {
      domainError(
        "CONFLICT",
        "The profile image changed after it was loaded.",
      );
    }
    if (
      (user.imageFileKey === undefined) !==
      (user.imageUploadId === undefined)
    ) {
      domainError(
        "CONFLICT",
        "The existing profile image metadata is incomplete.",
      );
    }
    if (
      user.imageFileKey === args.fileKey ||
      user.imageUploadId === args.uploadId
    ) {
      domainError(
        "CONFLICT",
        "The uploaded profile image is already in use.",
      );
    }

    const cleanup =
      user.imageFileKey === undefined ||
      user.imageUploadId === undefined
        ? null
        : await enqueueUploadThingDelete(ctx, {
            resourceType: "profileImage",
            resourceId: user.imageUploadId,
            providerKey: user.imageFileKey,
            requestedByUserId:
              ctx.actor.authenticatedUser._id,
            effectiveUserId: user._id,
            cutoverRunId: ctx.systemState.cutoverRunId,
            clientApiVersion: ctx.systemState.apiVersion,
          });
    const now = Date.now();
    await ctx.db.patch("users", user._id, {
      name,
      image,
      imageFileKey: args.fileKey,
      imageUploadId: args.uploadId,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.profile.imageUpdated",
      targetType: "user",
      targetId: user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      ...(cleanup === null
        ? {}
        : {
            metadata: {
              sideEffectIntentId: cleanup.intent._id,
            },
          }),
    });
    return { name, image, updatedAt: now };
  },
});

export const discardMyProfileImageUpload = authenticatedMutation({
  args: {
    fileKey: v.string(),
    uploadId: v.string(),
  },
  returns: v.object({
    queued: v.literal(true),
    intentId: v.id("sideEffectIntents"),
  }),
  handler: async (ctx, args) => {
    validateProfileImageUploadId(args.uploadId);
    if (
      ctx.actor.user.imageUploadId === args.uploadId ||
      ctx.actor.user.imageFileKey === args.fileKey
    ) {
      domainError(
        "CONFLICT",
        "The active profile image cannot be discarded.",
      );
    }
    const cleanup = await enqueueUploadThingDelete(ctx, {
      resourceType: "profileImage",
      resourceId: args.uploadId,
      providerKey: args.fileKey,
      requestedByUserId: ctx.actor.authenticatedUser._id,
      effectiveUserId: ctx.actor.user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      clientApiVersion: ctx.systemState.apiVersion,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "identity.profile.uploadDiscarded",
      targetType: "user",
      targetId: ctx.actor.user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        sideEffectIntentId: cleanup.intent._id,
      },
    });
    return {
      queued: true as const,
      intentId: cleanup.intent._id,
    };
  },
});

export const actionGateProbe = authenticatedAction({
  args: {},
  returns: v.object({
    allowed: v.literal(true),
    cutoverStage: cutoverStageValidator,
    isAdmin: v.boolean(),
  }),
  handler: async (ctx) => ({
    allowed: true as const,
    cutoverStage: ctx.systemState.cutoverStage,
    isAdmin: ctx.actor.isAdmin,
  }),
});
