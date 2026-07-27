import { v } from "convex/values";

import {
  recordingMutation,
  recordingQuery,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import { requireRecordingParticipant } from "./access.js";
import { requireRecordingSounder } from "./catalogModel.js";
import { requireRecordingTimestamp } from "./validators.js";

const MAX_SESSION_FAVORITES = 100;

const favoriteInput = v.object({
  id: v.string(),
  name: v.string(),
  category: v.string(),
  duration: v.number(),
  url: v.string(),
});

const favoriteValidator = v.object({
  id: v.string(),
  name: v.string(),
  category: v.string(),
  duration: v.number(),
  url: v.string(),
});

export const list = recordingQuery({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  returns: v.array(favoriteValidator),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    const favorites = await ctx.db
      .query("recordingSessionFavorites")
      .withIndex("by_publicSessionId", (query) =>
        query.eq(
          "publicSessionId",
          participant.publicSessionId,
        ),
      )
      .take(MAX_SESSION_FAVORITES + 1);
    if (favorites.length > MAX_SESSION_FAVORITES) {
      domainError(
        "CONFLICT",
        "The recording session exceeds its favorite limit.",
        { details: { limit: MAX_SESSION_FAVORITES } },
      );
    }
    return favorites
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder,
      )
      .map((favorite) => ({
        id: favorite.sounderId,
        name: favorite.name,
        category: favorite.category,
        duration: favorite.duration,
        url: favorite.url,
      }));
  },
});

export const replaceAll = recordingMutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    favorites: v.array(favoriteInput),
    updatedAt: v.number(),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    const participant = await requireRecordingParticipant(
      ctx,
      args,
    );
    if (args.favorites.length > MAX_SESSION_FAVORITES) {
      domainError(
        "VALIDATION_FAILED",
        `Recording sessions can have at most ${String(MAX_SESSION_FAVORITES)} favorites.`,
      );
    }
    const favorites = args.favorites.map(
      requireRecordingSounder,
    );
    if (
      new Set(
        favorites.map((favorite) => favorite.sounderId),
      ).size !== favorites.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Recording favorites cannot contain duplicate sounders.",
      );
    }
    const updatedAt = requireRecordingTimestamp(
      args.updatedAt,
      "Recording favorites update time",
    );
    const existing = await ctx.db
      .query("recordingSessionFavorites")
      .withIndex("by_publicSessionId", (query) =>
        query.eq(
          "publicSessionId",
          participant.publicSessionId,
        ),
      )
      .take(MAX_SESSION_FAVORITES + 1);
    if (existing.length > MAX_SESSION_FAVORITES) {
      domainError(
        "CONFLICT",
        "The recording session exceeds its favorite limit.",
      );
    }
    for (const favorite of existing) {
      await ctx.db.delete(
        "recordingSessionFavorites",
        favorite._id,
      );
    }
    for (const [sortOrder, favorite] of favorites.entries()) {
      await ctx.db.insert("recordingSessionFavorites", {
        publicSessionId: participant.publicSessionId,
        ...favorite,
        sortOrder,
        updatedAt,
      });
    }
    return { count: favorites.length };
  },
});
