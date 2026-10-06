import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { loadSeasonPerformance } from "./memberSeasonReadModel.js";
import {
  listQuoteArchiveSeasons,
  loadQuoteArchiveSeason,
} from "./quoteArchiveReadModel.js";
import {
  countSeasonEpisodesThrough,
  findCurrentSeason,
  hydrateSeason,
} from "./readModel.js";
import { loadResultEmbargo } from "./resultEmbargo.js";
import {
  currentPerformanceValidator,
  predictionScoringValidator,
  quoteArchiveSeasonDetailValidator,
  quoteArchiveSeasonValidator,
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
    // Standings move when an episode is published, not when it is recorded.
    const performance = await loadSeasonPerformance(
      ctx,
      season._id,
      "Current performance",
      await loadResultEmbargo(ctx),
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

export const quotabungaSeasons = anonymousQuery({
  args: { today: v.string() },
  returns: v.array(quoteArchiveSeasonValidator),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    return await listQuoteArchiveSeasons(ctx, today);
  },
});

/**
 * `now` only decides whether an unrevealed round reads as open or locked, so
 * a client that sends another time cannot reveal anything.
 */
export const quotabungaSeason = anonymousQuery({
  args: { seasonId: v.id("seasons"), today: v.string(), now: v.number() },
  returns: v.union(quoteArchiveSeasonDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const today = validatePlainDate(args.today, "Current date");
    const season = await ctx.db.get("seasons", args.seasonId);
    return season === null
      ? null
      : await loadQuoteArchiveSeason(ctx, season, { today, now: args.now });
  },
});
