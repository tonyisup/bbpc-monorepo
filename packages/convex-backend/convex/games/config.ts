import { v } from "convex/values";

import type { Id } from "../_generated/dataModel.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_GAME_POINT_TYPES,
  MAX_GAME_TYPES,
} from "./limits.js";
import {
  hydrateGamePointType,
  toGameType,
} from "./readModel.js";
import {
  gamePointTypeValidator,
  gameTypeValidator,
} from "./validators.js";
import {
  assertGamePointTypeUnreferenced,
  assertGameTypeUnreferenced,
  assertUniqueGamePointTypeLookup,
  assertUniqueGameTypeLookup,
  requireGamePointType,
  requireGameType,
  validateGameLookupId,
  validateGameTitle,
  validateOptionalGameText,
  validatePointTypeValue,
} from "./writeModel.js";

export const listGameTypes = adminQuery({
  args: {},
  returns: v.array(gameTypeValidator),
  handler: async (ctx) => {
    const gameTypes = await ctx.db
      .query("gameTypes")
      .withIndex("by_normalizedLookupId")
      .take(MAX_GAME_TYPES + 1);
    if (gameTypes.length > MAX_GAME_TYPES) {
      domainError(
        "CONFLICT",
        "The game type catalog exceeds its read limit.",
        { details: { limit: MAX_GAME_TYPES } },
      );
    }
    return gameTypes.map(toGameType);
  },
});

export const listGamePointTypes = adminQuery({
  args: { gameTypeId: v.optional(v.id("gameTypes")) },
  returns: v.array(gamePointTypeValidator),
  handler: async (ctx, args) => {
    const gameTypeId = args.gameTypeId;
    if (gameTypeId !== undefined) {
      await requireGameType(ctx, gameTypeId);
    }
    const pointTypes =
      gameTypeId === undefined
        ? await ctx.db
            .query("gamePointTypes")
            .withIndex("by_normalizedLookupId")
            .take(MAX_GAME_POINT_TYPES + 1)
        : await ctx.db
            .query("gamePointTypes")
            .withIndex("by_gameTypeId", (index) =>
              index.eq("gameTypeId", gameTypeId),
            )
            .take(MAX_GAME_POINT_TYPES + 1);
    if (pointTypes.length > MAX_GAME_POINT_TYPES) {
      domainError(
        "CONFLICT",
        "The game point type catalog exceeds its read limit.",
        { details: { limit: MAX_GAME_POINT_TYPES } },
      );
    }
    return await Promise.all(
      pointTypes.map((pointType) =>
        hydrateGamePointType(ctx, pointType),
      ),
    );
  },
});

export const createGameType = adminMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    lookupId: v.string(),
  },
  returns: gameTypeValidator,
  handler: async (ctx, args) => {
    const title = validateGameTitle(args.title, "Game type title");
    const lookup = validateGameLookupId(
      args.lookupId,
      "Game type lookup ID",
    );
    const description =
      args.description === undefined
        ? undefined
        : validateOptionalGameText(
            args.description,
            "Game type description",
          );
    await assertUniqueGameTypeLookup(
      ctx,
      lookup.normalizedLookupId,
    );
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title,
      ...lookup,
      ...(description === undefined ? {} : { description }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gameTypeCreated",
      targetType: "gameType",
      targetId: gameTypeId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toGameType(await requireGameType(ctx, gameTypeId));
  },
});

export const updateGameType = adminMutation({
  args: {
    id: v.id("gameTypes"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    lookupId: v.optional(v.string()),
  },
  returns: gameTypeValidator,
  handler: async (ctx, args) => {
    const gameType = await requireGameType(ctx, args.id);
    const patch: {
      title?: string;
      description?: string | undefined;
      lookupId?: string;
      normalizedLookupId?: string;
    } = {};
    if (args.title !== undefined) {
      patch.title = validateGameTitle(
        args.title,
        "Game type title",
      );
    }
    if (args.description !== undefined) {
      patch.description = validateOptionalGameText(
        args.description,
        "Game type description",
      );
    }
    if (args.lookupId !== undefined) {
      const lookup = validateGameLookupId(
        args.lookupId,
        "Game type lookup ID",
      );
      await assertUniqueGameTypeLookup(
        ctx,
        lookup.normalizedLookupId,
        gameType._id,
      );
      Object.assign(patch, lookup);
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return toGameType(gameType);
    }
    await ctx.db.patch("gameTypes", gameType._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gameTypeUpdated",
      targetType: "gameType",
      targetId: gameType._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return toGameType(await requireGameType(ctx, gameType._id));
  },
});

export const removeGameType = adminMutation({
  args: { id: v.id("gameTypes") },
  returns: v.object({ id: v.id("gameTypes") }),
  handler: async (ctx, args) => {
    const gameType = await requireGameType(ctx, args.id);
    await assertGameTypeUnreferenced(ctx, gameType._id);
    await ctx.db.delete("gameTypes", gameType._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gameTypeDeleted",
      targetType: "gameType",
      targetId: gameType._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: gameType._id };
  },
});

export const createGamePointType = adminMutation({
  args: {
    gameTypeId: v.id("gameTypes"),
    title: v.string(),
    description: v.optional(v.string()),
    lookupId: v.string(),
    points: v.number(),
  },
  returns: gamePointTypeValidator,
  handler: async (ctx, args) => {
    const gameType = await requireGameType(ctx, args.gameTypeId);
    const title = validateGameTitle(
      args.title,
      "Game point type title",
    );
    const lookup = validateGameLookupId(
      args.lookupId,
      "Game point type lookup ID",
    );
    const points = validatePointTypeValue(args.points);
    const description =
      args.description === undefined
        ? undefined
        : validateOptionalGameText(
            args.description,
            "Game point type description",
          );
    await assertUniqueGamePointTypeLookup(
      ctx,
      lookup.normalizedLookupId,
    );
    const pointTypeId = await ctx.db.insert("gamePointTypes", {
      gameTypeId: gameType._id,
      title,
      ...lookup,
      points,
      ...(description === undefined ? {} : { description }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamePointTypeCreated",
      targetType: "gamePointType",
      targetId: pointTypeId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGamePointType(
      ctx,
      await requireGamePointType(ctx, pointTypeId),
    );
  },
});

export const updateGamePointType = adminMutation({
  args: {
    id: v.id("gamePointTypes"),
    gameTypeId: v.optional(v.id("gameTypes")),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    lookupId: v.optional(v.string()),
    points: v.optional(v.number()),
  },
  returns: gamePointTypeValidator,
  handler: async (ctx, args) => {
    const pointType = await requireGamePointType(ctx, args.id);
    const patch: {
      gameTypeId?: Id<"gameTypes">;
      title?: string;
      description?: string | undefined;
      lookupId?: string;
      normalizedLookupId?: string;
      points?: number;
    } = {};
    if (args.gameTypeId !== undefined) {
      patch.gameTypeId = (
        await requireGameType(ctx, args.gameTypeId)
      )._id;
    }
    if (args.title !== undefined) {
      patch.title = validateGameTitle(
        args.title,
        "Game point type title",
      );
    }
    if (args.description !== undefined) {
      patch.description = validateOptionalGameText(
        args.description,
        "Game point type description",
      );
    }
    if (args.lookupId !== undefined) {
      const lookup = validateGameLookupId(
        args.lookupId,
        "Game point type lookup ID",
      );
      await assertUniqueGamePointTypeLookup(
        ctx,
        lookup.normalizedLookupId,
        pointType._id,
      );
      Object.assign(patch, lookup);
    }
    if (args.points !== undefined) {
      patch.points = validatePointTypeValue(args.points);
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return await hydrateGamePointType(ctx, pointType);
    }
    await ctx.db.patch("gamePointTypes", pointType._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamePointTypeUpdated",
      targetType: "gamePointType",
      targetId: pointType._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return await hydrateGamePointType(
      ctx,
      await requireGamePointType(ctx, pointType._id),
    );
  },
});

export const removeGamePointType = adminMutation({
  args: { id: v.id("gamePointTypes") },
  returns: v.object({ id: v.id("gamePointTypes") }),
  handler: async (ctx, args) => {
    const pointType = await requireGamePointType(ctx, args.id);
    await assertGamePointTypeUnreferenced(ctx, pointType._id);
    await ctx.db.delete("gamePointTypes", pointType._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamePointTypeDeleted",
      targetType: "gamePointType",
      targetId: pointType._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: pointType._id };
  },
});
