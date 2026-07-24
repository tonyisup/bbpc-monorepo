import { v } from "convex/values";

import { assignmentDetailValidator } from "../assignments/validators.js";
import { ratingValidator } from "../ratings/validators.js";
import { assignmentReviewDetailValidator } from "../reviews/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());
const nullableNumberValidator = v.union(v.number(), v.null());

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

export const pointUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
});

export const pointCoreValidator = v.object({
  id: v.id("points"),
  user: pointUserValidator,
  season: seasonValidator,
  reason: nullableStringValidator,
  earnedAt: v.number(),
  adjustment: nullableNumberValidator,
  gamePointType: v.union(gamePointTypeValidator, v.null()),
  total: v.number(),
});

export const assignmentPointLinkValidator = v.object({
  id: v.id("assignmentPointLinks"),
  assignment: assignmentDetailValidator,
});

export const pointDetailValidator = pointCoreValidator.extend({
  assignmentLinks: v.array(assignmentPointLinkValidator),
  guesses: v.array(
    v.object({
      id: v.id("guesses"),
      assignmentReviewId: v.id("assignmentReviews"),
    }),
  ),
  gamblingEntries: v.array(
    v.object({ id: v.id("gamblingEntries") }),
  ),
  tagVotes: v.array(
    v.object({
      id: v.id("tagVotes"),
      tag: v.string(),
    }),
  ),
  quoteSubmissions: v.array(
    v.object({ id: v.id("quoteSubmissions") }),
  ),
});

export const pointSeasonSelectorValidator = v.union(
  v.object({ kind: v.literal("all") }),
  v.object({
    kind: v.literal("current"),
    today: v.string(),
  }),
  v.object({
    kind: v.literal("season"),
    seasonId: v.id("seasons"),
  }),
);

export const pointSeasonTargetValidator = v.union(
  v.object({
    kind: v.literal("current"),
    today: v.string(),
  }),
  v.object({
    kind: v.literal("season"),
    seasonId: v.id("seasons"),
  }),
);

export const assignmentPointTotalValidator = v.object({
  userId: v.id("users"),
  assignmentId: v.id("assignments"),
  total: v.number(),
});

export const performancePointValidator = v.object({
  userId: v.id("users"),
  earnedAt: v.number(),
  pointValue: v.number(),
});

export const performanceUserValidator = v.object({
  user: pointUserValidator,
  total: v.number(),
});

export const currentPerformanceValidator = v.object({
  season: seasonValidator,
  userSummary: v.array(performanceUserValidator),
  points: v.array(performancePointValidator),
});

export const guessValidator = v.object({
  id: v.id("guesses"),
  createdAt: v.number(),
  user: pointUserValidator,
  rating: ratingValidator,
  assignmentReview: assignmentReviewDetailValidator,
  season: seasonValidator,
  point: v.union(pointCoreValidator, v.null()),
});

export const assignmentGuessGroupValidator = v.object({
  assignmentId: v.id("assignments"),
  guesses: v.array(guessValidator),
});

export const gamblingStatusValidator = v.union(
  v.literal("pending"),
  v.literal("locked"),
  v.literal("won"),
  v.literal("lost"),
  v.literal("rejected"),
);

export const gamblingTypeValidator = v.object({
  id: v.id("gamblingTypes"),
  lookupId: v.string(),
  title: v.string(),
  description: nullableStringValidator,
  multiplier: v.number(),
  isActive: v.boolean(),
  createdAt: v.number(),
});

export const gamblingEntryValidator = v.object({
  id: v.id("gamblingEntries"),
  points: v.number(),
  createdAt: v.number(),
  notes: nullableStringValidator,
  status: gamblingStatusValidator,
  user: pointUserValidator,
  assignment: v.union(assignmentDetailValidator, v.null()),
  gamblingType: gamblingTypeValidator,
  targetUser: v.union(pointUserValidator, v.null()),
  season: v.union(seasonValidator, v.null()),
  awardPoint: v.union(pointCoreValidator, v.null()),
});

export const assignmentGamblingGroupValidator = v.object({
  assignmentId: v.id("assignments"),
  entries: v.array(gamblingEntryValidator),
});
