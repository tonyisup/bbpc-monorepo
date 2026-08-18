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

export const pointEditableSnapshotValidator = v.object({
  userId: v.id("users"),
  seasonId: v.id("seasons"),
  reason: nullableStringValidator,
  adjustment: nullableNumberValidator,
  gamePointTypeId: v.union(v.id("gamePointTypes"), v.null()),
  earnedAt: v.number(),
});

export const pointDeleteImpactValidator = v.object({
  assignmentLinkCount: v.number(),
  guessCount: v.number(),
  gamblingEntryCount: v.number(),
  tagVoteCount: v.number(),
  quoteSubmissionCount: v.number(),
});

export const pointWorkbenchValidator = v.object({
  point: pointDetailValidator,
  impact: pointDeleteImpactValidator,
  guessAssignments: v.array(
    v.object({
      id: v.id("guesses"),
      assignmentReviewId: v.id("assignmentReviews"),
      assignment: assignmentDetailValidator,
    }),
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

export const seasonAdminPerformanceValidator = v.object({
  userSummary: v.array(
    v.object({
      user: pointUserValidator,
      total: v.number(),
      guessCount: v.number(),
      gamblingCount: v.number(),
    }),
  ),
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

export const tagValidator = v.object({
  id: v.id("tags"),
  name: v.string(),
  description: nullableStringValidator,
  createdAt: v.number(),
});

export const tagVoteAwardValidator = v.union(
  v.object({ kind: v.literal("unawarded") }),
  v.object({
    kind: v.literal("point"),
    point: pointCoreValidator,
  }),
  v.object({
    kind: v.literal("legacyAwardTombstone"),
  }),
);

export const tagVoteValidator = v.object({
  id: v.id("tagVotes"),
  tag: v.string(),
  tmdbId: v.number(),
  isTag: v.union(v.boolean(), v.null()),
  createdAt: v.number(),
  user: v.union(pointUserValidator, v.null()),
  award: tagVoteAwardValidator,
});

export const quoteSourceTypeValidator = v.union(
  v.literal("MOVIE"),
  v.literal("TV"),
  v.literal("OTHER"),
);

export const quoteStatusValidator = v.union(
  v.literal("SUBMITTED"),
  v.literal("INCLUDED"),
  v.literal("REJECTED"),
);

export const quoteEpisodeValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  status: nullableStringValidator,
});

export const quoteAdminEpisodeValidator =
  quoteEpisodeValidator.extend({
    submissionCount: v.number(),
  });

export const quoteMemberSubmissionValidator = v.object({
  id: v.id("quoteSubmissions"),
  quoteText: v.string(),
  sourceTitle: v.string(),
  sourceType: quoteSourceTypeValidator,
  clipUrl: nullableStringValidator,
  clipStartSeconds: nullableNumberValidator,
  listenerNotes: nullableStringValidator,
  status: quoteStatusValidator,
  bracketOrder: nullableNumberValidator,
  placement: nullableNumberValidator,
  scored: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const currentQuoteSubmissionValidator = v.object({
  episode: v.union(quoteEpisodeValidator, v.null()),
  isOpen: v.boolean(),
  submission: v.union(
    quoteMemberSubmissionValidator,
    v.null(),
  ),
});

export const quoteAdminUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  email: nullableStringValidator,
  image: nullableStringValidator,
});

export const quoteAdminSubmissionValidator =
  quoteMemberSubmissionValidator.extend({
    userId: v.id("users"),
    episodeId: v.id("episodes"),
    seasonId: v.id("seasons"),
    adminNotes: nullableStringValidator,
    user: quoteAdminUserValidator,
    episode: quoteEpisodeValidator,
    season: v.object({
      id: v.id("seasons"),
      title: v.string(),
    }),
    point: v.union(
      v.object({
        id: v.id("points"),
        adjustment: nullableNumberValidator,
        reason: nullableStringValidator,
      }),
      v.null(),
    ),
  });

export const assignmentGuessGroupValidator = v.object({
  assignmentId: v.id("assignments"),
  guesses: v.array(guessValidator),
});

export const guessSettlementOutcomeValidator = v.union(
  v.literal("allcorrect"),
  v.literal("all-incorrect"),
  v.literal("mixed"),
);

export const guessSettlementValidator = v.object({
  id: v.id("guessSettlements"),
  assignmentId: v.id("assignments"),
  userId: v.id("users"),
  seasonId: v.id("seasons"),
  outcome: guessSettlementOutcomeValidator,
  correctCount: v.number(),
  settledAt: v.number(),
});

export const guessSettlementResultValidator =
  guessSettlementValidator.extend({
    guessCount: v.number(),
    individualPointsCreated: v.number(),
    individualPointsRemoved: v.number(),
    groupPointChanged: v.boolean(),
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

export const gamblingEditableSnapshotValidator = v.object({
  points: v.number(),
  status: gamblingStatusValidator,
  awardPointId: v.union(v.id("points"), v.null()),
});

export const assignmentGamblingGroupValidator = v.object({
  assignmentId: v.id("assignments"),
  entries: v.array(gamblingEntryValidator),
});
