import { v } from "convex/values";

import {
  anonymousQuery,
  authenticatedQuery,
} from "../functions.js";
import {
  findCurrentSeason,
  hydrateSeason,
} from "./readModel.js";
import {
  predictionScoringValidator,
  seasonValidator,
} from "./validators.js";
import { validatePlainDate } from "./writeModel.js";

export const currentSeason = anonymousQuery({
  args: { today: v.string() },
  returns: v.union(seasonValidator, v.null()),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    const season = await findCurrentSeason(ctx, today);
    return season === null ? null : await hydrateSeason(ctx, season);
  },
});

export const hasActiveSeason = anonymousQuery({
  args: { today: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    return (await findCurrentSeason(ctx, today)) !== null;
  },
});

export const predictionScoring = authenticatedQuery({
  args: {},
  returns: predictionScoringValidator,
  handler: async (ctx) => {
    const gameType = await ctx.db
      .query("gameTypes")
      .withIndex("by_normalizedLookupId", (index) =>
        index.eq("normalizedLookupId", "wtfir"),
      )
      .first();
    if (gameType === null) {
      return {
        correctHost: null,
        allCorrectBonus: null,
        allIncorrect: null,
      };
    }
    const pointTypes = await Promise.all(
      ["guess", "allcorrect", "all-incorrect"].map(
        async (normalizedLookupId) => {
          const pointType = await ctx.db
            .query("gamePointTypes")
            .withIndex("by_normalizedLookupId", (index) =>
              index.eq(
                "normalizedLookupId",
                normalizedLookupId,
              ),
            )
            .first();
          return pointType?.gameTypeId === gameType._id
            ? pointType.points
            : null;
        },
      ),
    );
    return {
      correctHost: pointTypes[0] ?? null,
      allCorrectBonus: pointTypes[1] ?? null,
      allIncorrect: pointTypes[2] ?? null,
    };
  },
});
