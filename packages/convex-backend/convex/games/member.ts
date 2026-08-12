import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { authenticatedQuery } from "../functions.js";
import { calculateAvailablePointsForUser } from "./gamblingReadModel.js";
import { validatePointPageSize } from "./limits.js";
import { hydratePointCore } from "./pointReadModel.js";
import { resolvePointSeason } from "./pointWriteModel.js";
import { findCurrentSeason } from "./readModel.js";
import {
  pointCoreValidator,
  pointSeasonTargetValidator,
} from "./validators.js";
import { validatePlainDate } from "./writeModel.js";

export const myPointsPage = authenticatedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(pointCoreValidator),
  handler: async (ctx, args) => {
    validatePointPageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("points")
      .withIndex("by_userId_and_earnedAt", (index) =>
        index.eq("userId", ctx.actor.user._id),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((point) => hydratePointCore(ctx, point)),
      ),
    };
  },
});

export const myAvailablePoints = authenticatedQuery({
  args: { season: pointSeasonTargetValidator },
  returns: v.number(),
  handler: async (ctx, args) => {
    const season =
      args.season.kind === "season"
        ? await resolvePointSeason(ctx, args.season)
        : await findCurrentSeason(
            ctx,
            validatePlainDate(
              args.season.today,
              "Current season date",
            ),
          );
    if (season === null) {
      return 0;
    }
    return await calculateAvailablePointsForUser(
      ctx,
      ctx.actor.user._id,
      season._id,
    );
  },
});
