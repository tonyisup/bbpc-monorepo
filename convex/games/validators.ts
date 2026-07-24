import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());

export const gameTypeValidator = v.object({
  id: v.id("gameTypes"),
  title: v.string(),
  description: nullableStringValidator,
  lookupId: v.string(),
});

export const gamePointTypeValidator = v.object({
  id: v.id("gamePointTypes"),
  title: v.string(),
  description: nullableStringValidator,
  lookupId: v.string(),
  points: v.number(),
  gameType: gameTypeValidator,
});

export const seasonValidator = v.object({
  id: v.id("seasons"),
  title: v.string(),
  description: nullableStringValidator,
  startedOn: nullableStringValidator,
  endedOn: nullableStringValidator,
  gameType: gameTypeValidator,
});

const boundedCountValidator = v.object({
  count: v.number(),
  isExact: v.boolean(),
});

export const seasonAdminValidator = seasonValidator.extend({
  counts: v.object({
    points: boundedCountValidator,
    guesses: boundedCountValidator,
    gamblingEntries: boundedCountValidator,
    quoteSubmissions: boundedCountValidator,
  }),
});

export const predictionScoringValidator = v.object({
  correctHost: v.union(v.number(), v.null()),
  allCorrectBonus: v.union(v.number(), v.null()),
  allIncorrect: v.union(v.number(), v.null()),
});
