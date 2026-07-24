import { v } from "convex/values";

import { authenticatedQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ACTIVE_WAGERS_FOR_TOTAL,
  MAX_POINTS_FOR_AGGREGATE,
} from "./limits.js";
import { calculatePointTotal } from "./pointReadModel.js";
import { resolvePointSeason } from "./pointWriteModel.js";
import { findCurrentSeason } from "./readModel.js";
import { pointSeasonTargetValidator } from "./validators.js";
import { validatePlainDate } from "./writeModel.js";

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
    const [points, wagers] = await Promise.all([
      ctx.db
        .query("points")
        .withIndex("by_userId_and_seasonId", (index) =>
          index
            .eq("userId", ctx.actor.user._id)
            .eq("seasonId", season._id),
        )
        .take(MAX_POINTS_FOR_AGGREGATE + 1),
      ctx.db
        .query("gamblingEntries")
        .withIndex("by_userId_and_seasonId", (index) =>
          index
            .eq("userId", ctx.actor.user._id)
            .eq("seasonId", season._id),
        )
        .take(MAX_ACTIVE_WAGERS_FOR_TOTAL + 1),
    ]);
    if (wagers.length > MAX_ACTIVE_WAGERS_FOR_TOTAL) {
      domainError(
        "CONFLICT",
        "Active wagers exceed the supported point-total limit.",
        {
          details: {
            limit: MAX_ACTIVE_WAGERS_FOR_TOTAL,
          },
        },
      );
    }
    let wageredPoints = 0;
    for (const wager of wagers) {
      if (wager.status === "pending" || wager.status === "locked") {
        wageredPoints += wager.points;
      }
    }
    return (await calculatePointTotal(ctx, points)) - wageredPoints;
  },
});
