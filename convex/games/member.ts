import { v } from "convex/values";

import { authenticatedQuery } from "../functions.js";
import { calculateAvailablePointsForUser } from "./gamblingReadModel.js";
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
    return await calculateAvailablePointsForUser(
      ctx,
      ctx.actor.user._id,
      season._id,
    );
  },
});
