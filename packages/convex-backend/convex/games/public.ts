import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { loadSeasonPerformance } from "./memberSeasonReadModel.js";
import {
  countSeasonEpisodesThrough,
  findCurrentSeason,
  hydrateSeason,
} from "./readModel.js";
import {
  currentPerformanceValidator,
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

export const predictionScoring = anonymousQuery({
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

export const currentPerformance = anonymousQuery({
  args: { today: v.string() },
  returns: v.union(currentPerformanceValidator, v.null()),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    const season = await findCurrentSeason(ctx, today);
    if (season === null) {
      return null;
    }
    const performance = await loadSeasonPerformance(
      ctx,
      season._id,
      "Current performance",
    );
    return {
      season: await hydrateSeason(ctx, season),
      recordedEpisodeCount: await countSeasonEpisodesThrough(
        ctx,
        season,
        today,
      ),
      ...performance,
    };
  },
});
