import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  applicationWriteModeValidator,
  cutoverStageValidator,
} from "./lib/validators.js";

const userStatus = v.union(v.literal("active"), v.literal("disabled"));
const principalStatus = v.union(v.literal("active"), v.literal("disabled"));
const migrationRunStatus = v.union(
  v.literal("running"),
  v.literal("transformed"),
  v.literal("reconciled"),
  v.literal("failed"),
);
const migrationCheckpointStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
);
const auditValue = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);

export default defineSchema({
  users: defineTable({
    legacyId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    emailVerifiedAt: v.optional(v.number()),
    image: v.optional(v.string()),
    status: userStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedEmail", ["normalizedEmail"])
    .index("by_status", ["status"]),

  authIdentities: defineTable({
    tokenIdentifier: v.string(),
    issuer: v.string(),
    subject: v.string(),
    userId: v.id("users"),
    verifiedEmail: v.optional(v.string()),
    linkedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_issuer_and_subject", ["issuer", "subject"])
    .index("by_userId", ["userId"]),

  roles: defineTable({
    legacyId: v.optional(v.number()),
    name: v.string(),
    normalizedName: v.string(),
    description: v.string(),
    admin: v.boolean(),
    permissions: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedName", ["normalizedName"]),

  userRoles: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    roleId: v.id("roles"),
    assignedAt: v.optional(v.number()),
    assignedBy: v.optional(v.id("users")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_roleId", ["roleId"])
    .index("by_userId_and_roleId", ["userId", "roleId"]),

  impersonationSessions: defineTable({
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.string(),
    startedAt: v.number(),
    endsAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
  })
    .index("by_actorUserId_and_startedAt", ["actorUserId", "startedAt"])
    .index("by_targetUserId_and_startedAt", ["targetUserId", "startedAt"]),

  servicePrincipals: defineTable({
    tokenIdentifier: v.string(),
    issuer: v.string(),
    subject: v.string(),
    name: v.string(),
    status: principalStatus,
    permissions: v.array(v.string()),
    cutoverRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    rotatedAt: v.optional(v.number()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_issuer_and_subject", ["issuer", "subject"])
    .index("by_status", ["status"]),

  systemState: defineTable({
    singletonKey: v.literal("global"),
    cutoverStage: cutoverStageValidator,
    applicationWriteMode: applicationWriteModeValidator,
    cutoverRunId: v.string(),
    apiVersion: v.string(),
    approvedBackupId: v.optional(v.string()),
    approvedBackupChecksum: v.optional(v.string()),
    goNoGoApprovedAt: v.optional(v.number()),
    firstApplicationWriteAt: v.optional(v.number()),
    initializedAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_singletonKey", ["singletonKey"]),

  auditEvents: defineTable({
    actorType: v.union(
      v.literal("user"),
      v.literal("service"),
      v.literal("internal"),
      v.literal("control"),
    ),
    actorUserId: v.optional(v.id("users")),
    servicePrincipalId: v.optional(v.id("servicePrincipals")),
    impersonationSessionId: v.optional(v.id("impersonationSessions")),
    action: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    cutoverRunId: v.optional(v.string()),
    createdAt: v.number(),
    metadata: v.optional(v.record(v.string(), auditValue)),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_servicePrincipalId_and_createdAt", [
      "servicePrincipalId",
      "createdAt",
    ])
    .index("by_cutoverRunId_and_createdAt", ["cutoverRunId", "createdAt"]),

  archivePosts: defineTable({
    legacyId: v.optional(v.number()),
    postedAt: v.number(),
    content: v.string(),
    title: v.string(),
    episodeId: v.optional(v.id("episodes")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId_and_postedAt", ["episodeId", "postedAt"]),

  episodes: defineTable({
    legacyId: v.optional(v.string()),
    number: v.number(),
    title: v.string(),
    recording: v.optional(v.string()),
    date: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    seoDescription: v.optional(v.string()),
    seoKeywords: v.optional(v.string()),
    seoTitle: v.optional(v.string()),
    slug: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_number", ["number"])
    .index("by_slug", ["slug"])
    .index("by_date_and_status", ["date", "status"]),

  episodeLinks: defineTable({
    legacyId: v.optional(v.string()),
    url: v.string(),
    text: v.string(),
    episodeId: v.optional(v.id("episodes")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId", ["episodeId"]),

  bangers: defineTable({
    legacyId: v.optional(v.string()),
    title: v.string(),
    artist: v.string(),
    url: v.string(),
    episodeId: v.optional(v.id("episodes")),
    userId: v.optional(v.id("users")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId", ["episodeId"])
    .index("by_userId", ["userId"]),

  episodeAudioMessages: defineTable({
    legacyId: v.optional(v.number()),
    url: v.string(),
    createdAt: v.number(),
    fileKey: v.optional(v.string()),
    userId: v.id("users"),
    episodeId: v.optional(v.id("episodes")),
    notes: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId", ["episodeId"])
    .index("by_userId", ["userId"]),

  movies: defineTable({
    legacyId: v.optional(v.string()),
    title: v.string(),
    normalizedTitle: v.string(),
    year: v.number(),
    poster: v.optional(v.string()),
    url: v.string(),
    tmdbId: v.optional(v.number()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_tmdbId", ["tmdbId"])
    .index("by_normalizedTitle_and_year", ["normalizedTitle", "year"]),

  shows: defineTable({
    legacyId: v.optional(v.string()),
    title: v.string(),
    normalizedTitle: v.string(),
    year: v.number(),
    poster: v.optional(v.string()),
    url: v.string(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedTitle_and_year", ["normalizedTitle", "year"]),

  tags: defineTable({
    legacyId: v.optional(v.string()),
    name: v.string(),
    normalizedName: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedName", ["normalizedName"]),

  assignments: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    episodeId: v.id("episodes"),
    movieId: v.id("movies"),
    type: v.string(),
    playable: v.boolean(),
    slug: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_episodeId", ["episodeId"])
    .index("by_movieId", ["movieId"])
    .index("by_slug", ["slug"]),

  assignmentAudioMessages: defineTable({
    legacyId: v.optional(v.number()),
    url: v.string(),
    createdAt: v.number(),
    userId: v.id("users"),
    assignmentId: v.optional(v.id("assignments")),
    fileKey: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_userId", ["userId"]),

  assignmentPointLinks: defineTable({
    legacyId: v.optional(v.string()),
    assignmentId: v.id("assignments"),
    userId: v.id("users"),
    pointId: v.id("points"),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_userId", ["userId"])
    .index("by_pointId", ["pointId"]),

  syllabusEntries: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    movieId: v.id("movies"),
    order: v.number(),
    createdAt: v.number(),
    assignmentId: v.optional(v.id("assignments")),
    notes: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId_and_order", ["userId", "order"])
    .index("by_movieId", ["movieId"])
    .index("by_assignmentId", ["assignmentId"]),

  ratings: defineTable({
    legacyId: v.optional(v.string()),
    name: v.string(),
    value: v.number(),
    sound: v.optional(v.string()),
    icon: v.optional(v.string()),
    category: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_value", ["value"]),

  reviews: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    movieId: v.optional(v.id("movies")),
    ratingId: v.optional(v.id("ratings")),
    showId: v.optional(v.id("shows")),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_movieId", ["movieId"])
    .index("by_showId", ["showId"])
    .index("by_ratingId", ["ratingId"]),

  assignmentReviews: defineTable({
    legacyId: v.optional(v.string()),
    assignmentId: v.id("assignments"),
    reviewId: v.id("reviews"),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_reviewId", ["reviewId"]),

  extraReviews: defineTable({
    legacyId: v.optional(v.string()),
    reviewId: v.id("reviews"),
    episodeId: v.id("episodes"),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId", ["episodeId"])
    .index("by_reviewId", ["reviewId"]),

  gameTypes: defineTable({
    legacyId: v.optional(v.number()),
    title: v.string(),
    description: v.optional(v.string()),
    lookupId: v.string(),
    normalizedLookupId: v.string(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedLookupId", ["normalizedLookupId"]),

  gamePointTypes: defineTable({
    legacyId: v.optional(v.number()),
    lookupId: v.string(),
    normalizedLookupId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    points: v.number(),
    gameTypeId: v.id("gameTypes"),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedLookupId", ["normalizedLookupId"])
    .index("by_gameTypeId", ["gameTypeId"]),

  seasons: defineTable({
    legacyId: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    gameTypeId: v.id("gameTypes"),
    endedOn: v.optional(v.string()),
    startedOn: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_gameTypeId", ["gameTypeId"])
    .index("by_startedOn", ["startedOn"]),

  points: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    seasonId: v.id("seasons"),
    reason: v.optional(v.string()),
    earnedAt: v.number(),
    adjustment: v.union(v.number(), v.null()),
    gamePointTypeId: v.optional(v.id("gamePointTypes")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_seasonId", ["seasonId"])
    .index("by_gamePointTypeId", ["gamePointTypeId"])
    .index("by_userId_and_seasonId", ["userId", "seasonId"]),

  guesses: defineTable({
    legacyId: v.optional(v.string()),
    ratingId: v.id("ratings"),
    createdAt: v.number(),
    userId: v.id("users"),
    assignmentReviewId: v.id("assignmentReviews"),
    seasonId: v.id("seasons"),
    pointId: v.optional(v.id("points")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_assignmentReviewId", ["assignmentReviewId"])
    .index("by_seasonId", ["seasonId"])
    .index("by_pointId", ["pointId"])
    .index("by_userId_and_assignmentReviewId", [
      "userId",
      "assignmentReviewId",
    ]),

  gamblingTypes: defineTable({
    legacyId: v.optional(v.string()),
    lookupId: v.string(),
    normalizedLookupId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    multiplier: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedLookupId", ["normalizedLookupId"]),

  gamblingEntries: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    assignmentId: v.optional(v.id("assignments")),
    points: v.number(),
    createdAt: v.number(),
    awardPointId: v.optional(v.id("points")),
    seasonId: v.optional(v.id("seasons")),
    notes: v.optional(v.string()),
    gamblingTypeId: v.id("gamblingTypes"),
    targetUserId: v.optional(v.id("users")),
    status: v.string(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_awardPointId", ["awardPointId"])
    .index("by_seasonId", ["seasonId"])
    .index("by_gamblingTypeId", ["gamblingTypeId"])
    .index("by_targetUserId", ["targetUserId"])
    .index("by_userId_and_seasonId", ["userId", "seasonId"]),

  tagVotes: defineTable({
    legacyId: v.optional(v.string()),
    tag: v.string(),
    normalizedTag: v.string(),
    tmdbId: v.number(),
    isTag: v.optional(v.boolean()),
    createdAt: v.number(),
    sessionId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    award: v.union(
      v.object({ kind: v.literal("unawarded") }),
      v.object({
        kind: v.literal("point"),
        pointId: v.id("points"),
      }),
      v.object({
        kind: v.literal("legacyAwardTombstone"),
        legacyPointId: v.string(),
      }),
    ),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_normalizedTag_and_userId", ["normalizedTag", "userId"])
    .index("by_tmdbId_and_normalizedTag", ["tmdbId", "normalizedTag"]),

  quoteSubmissions: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    episodeId: v.id("episodes"),
    seasonId: v.id("seasons"),
    quoteText: v.string(),
    sourceTitle: v.string(),
    sourceType: v.string(),
    clipUrl: v.optional(v.string()),
    clipStartSeconds: v.optional(v.number()),
    listenerNotes: v.optional(v.string()),
    status: v.string(),
    bracketOrder: v.optional(v.number()),
    placement: v.optional(v.number()),
    adminNotes: v.optional(v.string()),
    pointId: v.optional(v.id("points")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId_and_status", ["episodeId", "status"])
    .index("by_episodeId_and_userId", ["episodeId", "userId"])
    .index("by_seasonId", ["seasonId"])
    .index("by_userId", ["userId"])
    .index("by_pointId", ["pointId"]),

  rankedListTypes: defineTable({
    legacyId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    maxItems: v.number(),
    targetType: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_legacyId", ["legacyId"]),

  rankedLists: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    rankedListTypeId: v.id("rankedListTypes"),
    status: v.string(),
    title: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_rankedListTypeId", ["rankedListTypeId"])
    .index("by_userId_and_rankedListTypeId", [
      "userId",
      "rankedListTypeId",
    ]),

  rankedItems: defineTable({
    legacyId: v.optional(v.string()),
    rankedListId: v.id("rankedLists"),
    targetType: v.union(
      v.literal("movie"),
      v.literal("show"),
      v.literal("episode"),
    ),
    movieId: v.optional(v.id("movies")),
    showId: v.optional(v.id("shows")),
    episodeId: v.optional(v.id("episodes")),
    rank: v.number(),
    comment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_rankedListId_and_rank", ["rankedListId", "rank"])
    .index("by_movieId", ["movieId"])
    .index("by_showId", ["showId"])
    .index("by_episodeId", ["episodeId"]),

  migrationRuns: defineTable({
    runId: v.string(),
    sourceSchemaFingerprint: v.string(),
    status: migrationRunStatus,
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_runId", ["runId"]),

  migrationDomainRuns: defineTable({
    runId: v.string(),
    domain: v.string(),
    status: migrationRunStatus,
    expectedCounts: v.record(v.string(), v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_runId_and_domain", ["runId", "domain"]),

  migrationCheckpoints: defineTable({
    runId: v.string(),
    operation: v.string(),
    status: migrationCheckpointStatus,
    lastLegacyKey: v.optional(v.string()),
    processedCount: v.number(),
    insertedCount: v.number(),
    reusedCount: v.number(),
    updatedAt: v.number(),
  }).index("by_runId_and_operation", ["runId", "operation"]),

  migrationRawUsers: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerifiedAt: v.optional(v.number()),
    image: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawRoles: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    name: v.string(),
    description: v.string(),
    admin: v.boolean(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawUserRoles: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    roleLegacyId: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),
});
