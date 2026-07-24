import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  hydrateAdminSeason,
  requireGameTypeDocument,
} from "./readModel.js";
import {
  seasonAdminValidator,
} from "./validators.js";
import { validateSeasonPageSize } from "./limits.js";
import {
  assertSeasonUnreferenced,
  requireSeason,
  validateGameTitle,
  validateOptionalGameText,
  validatePlainDate,
  validateSeasonRange,
} from "./writeModel.js";

export const getById = adminQuery({
  args: { id: v.id("seasons") },
  returns: v.union(seasonAdminValidator, v.null()),
  handler: async (ctx, args) => {
    const season = await ctx.db.get("seasons", args.id);
    return season === null
      ? null
      : await hydrateAdminSeason(ctx, season);
  },
});

export const listPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(seasonAdminValidator),
  handler: async (ctx, args) => {
    validateSeasonPageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("seasons")
      .withIndex("by_startedOn")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((season) =>
          hydrateAdminSeason(ctx, season),
        ),
      ),
    };
  },
});

export const create = adminMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    gameTypeId: v.id("gameTypes"),
    startedOn: v.string(),
    endedOn: v.optional(v.union(v.string(), v.null())),
  },
  returns: seasonAdminValidator,
  handler: async (ctx, args) => {
    const gameType = await requireGameTypeDocument(
      ctx,
      args.gameTypeId,
    );
    const title = validateGameTitle(args.title, "Season title");
    const description =
      args.description === undefined
        ? undefined
        : validateOptionalGameText(
            args.description,
            "Season description",
          );
    const startedOn = validatePlainDate(
      args.startedOn,
      "Season start date",
    );
    const endedOn =
      args.endedOn === undefined || args.endedOn === null
        ? undefined
        : validatePlainDate(args.endedOn, "Season end date");
    validateSeasonRange(startedOn, endedOn);
    const seasonId = await ctx.db.insert("seasons", {
      title,
      gameTypeId: gameType._id,
      startedOn,
      ...(description === undefined ? {} : { description }),
      ...(endedOn === undefined ? {} : { endedOn }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.seasonCreated",
      targetType: "season",
      targetId: seasonId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateAdminSeason(
      ctx,
      await requireSeason(ctx, seasonId),
    );
  },
});

export const update = adminMutation({
  args: {
    id: v.id("seasons"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    gameTypeId: v.optional(v.id("gameTypes")),
    startedOn: v.optional(v.string()),
    endedOn: v.optional(v.union(v.string(), v.null())),
  },
  returns: seasonAdminValidator,
  handler: async (ctx, args) => {
    const season = await requireSeason(ctx, args.id);
    const patch: {
      title?: string;
      description?: string | undefined;
      gameTypeId?: typeof season.gameTypeId;
      startedOn?: string;
      endedOn?: string | undefined;
    } = {};
    if (args.title !== undefined) {
      patch.title = validateGameTitle(args.title, "Season title");
    }
    if (args.description !== undefined) {
      patch.description = validateOptionalGameText(
        args.description,
        "Season description",
      );
    }
    if (args.gameTypeId !== undefined) {
      patch.gameTypeId = (
        await requireGameTypeDocument(ctx, args.gameTypeId)
      )._id;
    }
    if (args.startedOn !== undefined) {
      patch.startedOn = validatePlainDate(
        args.startedOn,
        "Season start date",
      );
    }
    if (args.endedOn !== undefined) {
      patch.endedOn =
        args.endedOn === null
          ? undefined
          : validatePlainDate(args.endedOn, "Season end date");
    }
    const startedOn = patch.startedOn ?? season.startedOn;
    if (startedOn === undefined) {
      throw new Error("Writable season is missing a start date.");
    }
    validateSeasonRange(
      startedOn,
      Object.prototype.hasOwnProperty.call(patch, "endedOn")
        ? patch.endedOn
        : season.endedOn,
    );
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return await hydrateAdminSeason(ctx, season);
    }
    await ctx.db.patch("seasons", season._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.seasonUpdated",
      targetType: "season",
      targetId: season._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return await hydrateAdminSeason(
      ctx,
      await requireSeason(ctx, season._id),
    );
  },
});

export const removeIfUnreferenced = adminMutation({
  args: { id: v.id("seasons") },
  returns: v.object({ id: v.id("seasons") }),
  handler: async (ctx, args) => {
    const season = await requireSeason(ctx, args.id);
    await assertSeasonUnreferenced(ctx, season._id);
    await ctx.db.delete("seasons", season._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.seasonDeleted",
      targetType: "season",
      targetId: season._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: season._id };
  },
});
