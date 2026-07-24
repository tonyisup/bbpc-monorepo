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
const migrationScrubStatus = v.union(
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
    .index("by_name", ["name"])
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
    normalizedSlug: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_number", ["number"])
    .index("by_status_and_number", ["status", "number"])
    .index("by_status_and_date", ["status", "date"])
    .index("by_slug", ["slug"])
    .index("by_normalizedSlug", ["normalizedSlug"])
    .index("by_date_and_status", ["date", "status"])
    .searchIndex("search_title", { searchField: "title" }),

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
    .index("by_title", ["title"])
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
    .index("by_userId", ["userId"])
    .index("by_userId_and_episodeId_and_createdAt", [
      "userId",
      "episodeId",
      "createdAt",
    ]),

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
    .index("by_url", ["url"])
    .index("by_year", ["year"])
    .index("by_normalizedTitle_and_year", ["normalizedTitle", "year"])
    .searchIndex("search_title", { searchField: "title" }),

  shows: defineTable({
    legacyId: v.optional(v.string()),
    title: v.string(),
    normalizedTitle: v.string(),
    year: v.number(),
    poster: v.optional(v.string()),
    url: v.string(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_url", ["url"])
    .index("by_year", ["year"])
    .index("by_normalizedTitle_and_year", ["normalizedTitle", "year"])
    .searchIndex("search_title", { searchField: "title" }),

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
    normalizedSlug: v.optional(v.string()),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_movieId_and_episodeId", [
      "userId",
      "movieId",
      "episodeId",
    ])
    .index("by_episodeId", ["episodeId"])
    .index("by_movieId", ["movieId"])
    .index("by_slug", ["slug"])
    .index("by_normalizedSlug", ["normalizedSlug"]),

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
    .index("by_assignmentId_and_userId", [
      "assignmentId",
      "userId",
    ])
    .index("by_userId", ["userId"])
    .index("by_pointId", ["pointId"])
    .index("by_assignmentId_and_userId_and_pointId", [
      "assignmentId",
      "userId",
      "pointId",
    ]),

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
    .index("by_createdAt", ["createdAt"])
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
    .index("by_userId_and_movieId", ["userId", "movieId"])
    .index("by_movieId", ["movieId"])
    .index("by_showId", ["showId"])
    .index("by_ratingId", ["ratingId"])
    .index("by_reviewedAt", ["reviewedAt"])
    .index("by_userId_and_reviewedAt", ["userId", "reviewedAt"])
    .index("by_ratingId_and_reviewedAt", [
      "ratingId",
      "reviewedAt",
    ])
    .index("by_ratingId_and_userId_and_reviewedAt", [
      "ratingId",
      "userId",
      "reviewedAt",
    ]),

  assignmentReviews: defineTable({
    legacyId: v.optional(v.string()),
    assignmentId: v.id("assignments"),
    reviewId: v.id("reviews"),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_reviewId", ["reviewId"])
    .index("by_assignmentId_and_reviewId", [
      "assignmentId",
      "reviewId",
    ]),

  extraReviews: defineTable({
    legacyId: v.optional(v.string()),
    reviewId: v.id("reviews"),
    episodeId: v.id("episodes"),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId", ["episodeId"])
    .index("by_reviewId", ["reviewId"])
    .index("by_reviewId_and_episodeId", [
      "reviewId",
      "episodeId",
    ]),

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
    .index("by_userId_and_earnedAt", ["userId", "earnedAt"])
    .index("by_seasonId", ["seasonId"])
    .index("by_seasonId_and_earnedAt", [
      "seasonId",
      "earnedAt",
    ])
    .index("by_gamePointTypeId", ["gamePointTypeId"])
    .index("by_userId_and_seasonId", ["userId", "seasonId"])
    .index("by_userId_and_seasonId_and_earnedAt", [
      "userId",
      "seasonId",
      "earnedAt",
    ]),

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
    .index("by_ratingId", ["ratingId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_seasonId_and_createdAt", [
      "userId",
      "seasonId",
      "createdAt",
    ])
    .index("by_assignmentReviewId", ["assignmentReviewId"])
    .index("by_seasonId", ["seasonId"])
    .index("by_seasonId_and_createdAt", [
      "seasonId",
      "createdAt",
    ])
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
    .index("by_createdAt", ["createdAt"])
    .index("by_isActive_and_createdAt", [
      "isActive",
      "createdAt",
    ])
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
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_userId_and_assignmentId", [
      "userId",
      "assignmentId",
    ])
    .index("by_userId_and_gamblingTypeId", [
      "userId",
      "gamblingTypeId",
    ])
    .index("by_userId_and_seasonId_and_createdAt", [
      "userId",
      "seasonId",
      "createdAt",
    ])
    .index("by_userId_and_seasonId_and_status", [
      "userId",
      "seasonId",
      "status",
    ])
    .index("by_canonicalWagerKey", [
      "userId",
      "seasonId",
      "gamblingTypeId",
      "assignmentId",
      "targetUserId",
    ])
    .index("by_assignmentId", ["assignmentId"])
    .index("by_assignmentId_and_createdAt", [
      "assignmentId",
      "createdAt",
    ])
    .index("by_assignmentId_and_status", [
      "assignmentId",
      "status",
    ])
    .index("by_awardPointId", ["awardPointId"])
    .index("by_seasonId", ["seasonId"])
    .index("by_gamblingTypeId", ["gamblingTypeId"])
    .index("by_gamblingTypeId_and_createdAt", [
      "gamblingTypeId",
      "createdAt",
    ])
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
        legacyPointId: v.optional(v.string()),
      }),
    ),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_tmdbId_and_createdAt", ["tmdbId", "createdAt"])
    .index("by_legacyAwardPointId", ["award.legacyPointId"])
    .index("by_awardKind_and_awardPointId", [
      "award.kind",
      "award.pointId",
    ])
    .index("by_normalizedTag_and_userId", ["normalizedTag", "userId"])
    .index("by_tmdbId_and_normalizedTag", ["tmdbId", "normalizedTag"])
    .index("by_userId_and_tmdbId_and_normalizedTag", [
      "userId",
      "tmdbId",
      "normalizedTag",
    ]),

  quoteSubmissions: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    episodeId: v.id("episodes"),
    seasonId: v.id("seasons"),
    quoteText: v.string(),
    sourceTitle: v.string(),
    sourceType: v.union(
      v.literal("MOVIE"),
      v.literal("TV"),
      v.literal("OTHER"),
    ),
    clipUrl: v.optional(v.string()),
    clipStartSeconds: v.optional(v.number()),
    listenerNotes: v.optional(v.string()),
    status: v.union(
      v.literal("SUBMITTED"),
      v.literal("INCLUDED"),
      v.literal("REJECTED"),
    ),
    bracketOrder: v.optional(v.number()),
    placement: v.optional(v.number()),
    adminNotes: v.optional(v.string()),
    pointId: v.optional(v.id("points")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_episodeId", ["episodeId"])
    .index("by_episodeId_and_status", ["episodeId", "status"])
    .index("by_episodeId_and_userId", ["episodeId", "userId"])
    .index("by_episodeId_and_createdAt", ["episodeId", "createdAt"])
    .index("by_episodeId_and_bracketOrder_and_createdAt", [
      "episodeId",
      "bracketOrder",
      "createdAt",
    ])
    .index("by_seasonId", ["seasonId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_pointId", ["pointId"]),

  rankedListTypes: defineTable({
    legacyId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    maxItems: v.number(),
    targetType: v.union(
      v.literal("MOVIE"),
      v.literal("SHOW"),
      v.literal("EPISODE"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_createdAt", ["createdAt"]),

  rankedLists: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    rankedListTypeId: v.id("rankedListTypes"),
    status: v.union(v.literal("DRAFT"), v.literal("PUBLISHED")),
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
    ])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"])
    .index("by_rankedListTypeId_and_updatedAt", [
      "rankedListTypeId",
      "updatedAt",
    ])
    .index("by_userId_and_rankedListTypeId_and_updatedAt", [
      "userId",
      "rankedListTypeId",
      "updatedAt",
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
    .index("by_rankedListId_and_movieId", [
      "rankedListId",
      "movieId",
    ])
    .index("by_rankedListId_and_showId", [
      "rankedListId",
      "showId",
    ])
    .index("by_rankedListId_and_episodeId", [
      "rankedListId",
      "episodeId",
    ])
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

  migrationScrubRuns: defineTable({
    runId: v.string(),
    scope: v.string(),
    status: migrationScrubStatus,
    identityRawRowsDeleted: v.number(),
    catalogRawRowsDeleted: v.number(),
    episodeRawRowsDeleted: v.number(),
    checkpointsDeleted: v.number(),
    rawRowsDeleted: v.optional(v.record(v.string(), v.number())),
    domainRunsDeleted: v.optional(v.number()),
    migrationRunsDeleted: v.optional(v.number()),
    priorScrubRunsDeleted: v.optional(v.number()),
    impersonationSessionsDeleted: v.optional(v.number()),
    servicePrincipalsDeleted: v.optional(v.number()),
    tagAwardArchiveIdsRemoved: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_runId_and_scope", ["runId", "scope"]),

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

  migrationRawMovies: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    title: v.string(),
    year: v.number(),
    poster: v.optional(v.string()),
    url: v.string(),
    tmdbId: v.optional(v.number()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawShows: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    title: v.string(),
    year: v.number(),
    poster: v.optional(v.string()),
    url: v.string(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawTags: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    createdAt: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawEpisodes: defineTable({
    runId: v.string(),
    legacyId: v.string(),
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
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawEpisodeLinks: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    url: v.string(),
    text: v.string(),
    episodeLegacyId: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawBangers: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    title: v.string(),
    artist: v.string(),
    url: v.string(),
    episodeLegacyId: v.optional(v.string()),
    userLegacyId: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawEpisodeAudioMessages: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    url: v.string(),
    createdAt: v.number(),
    fileKey: v.optional(v.string()),
    userLegacyId: v.string(),
    episodeLegacyId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawAssignments: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    slug: v.optional(v.string()),
    userLegacyId: v.string(),
    episodeLegacyId: v.string(),
    movieLegacyId: v.string(),
    type: v.string(),
    playable: v.boolean(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawAssignmentAudioMessages: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    url: v.string(),
    createdAt: v.number(),
    userLegacyId: v.string(),
    assignmentLegacyId: v.optional(v.string()),
    fileKey: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawAssignmentPointLinks: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    assignmentLegacyId: v.string(),
    userLegacyId: v.string(),
    pointLegacyId: v.string(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawSyllabusEntries: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    movieLegacyId: v.string(),
    order: v.number(),
    createdAt: v.number(),
    assignmentLegacyId: v.optional(v.string()),
    notes: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawRatings: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    name: v.string(),
    value: v.number(),
    sound: v.optional(v.string()),
    icon: v.optional(v.string()),
    category: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawReviews: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.optional(v.string()),
    movieLegacyId: v.optional(v.string()),
    ratingLegacyId: v.optional(v.string()),
    reviewdOn: v.optional(v.number()),
    showLegacyId: v.optional(v.string()),
    reviewedOn: v.optional(v.number()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawAssignmentReviews: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    assignmentLegacyId: v.string(),
    reviewLegacyId: v.string(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawExtraReviews: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    reviewLegacyId: v.string(),
    episodeLegacyId: v.string(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawGameTypes: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    title: v.string(),
    description: v.optional(v.string()),
    lookupId: v.string(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawGamePointTypes: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    lookupId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    points: v.number(),
    gameTypeLegacyId: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawSeasons: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    gameTypeLegacyId: v.number(),
    endedOn: v.optional(v.string()),
    startedOn: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawPoints: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    seasonLegacyId: v.string(),
    reason: v.optional(v.string()),
    earnedAt: v.number(),
    adjustment: v.union(v.number(), v.null()),
    gamePointTypeLegacyId: v.optional(v.number()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawGuesses: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    ratingLegacyId: v.string(),
    createdAt: v.number(),
    userLegacyId: v.string(),
    assignmentReviewLegacyId: v.string(),
    seasonLegacyId: v.string(),
    pointLegacyId: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawGamblingTypes: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    lookupId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    multiplier: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawGamblingEntries: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    assignmentLegacyId: v.optional(v.string()),
    points: v.number(),
    createdAt: v.number(),
    pointLegacyId: v.optional(v.string()),
    seasonLegacyId: v.optional(v.string()),
    notes: v.optional(v.string()),
    gamblingTypeLegacyId: v.string(),
    targetUserLegacyId: v.optional(v.string()),
    status: v.string(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawTagVotes: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    tag: v.string(),
    tmdbId: v.number(),
    isTag: v.optional(v.boolean()),
    createdAt: v.number(),
    sessionId: v.optional(v.string()),
    userLegacyId: v.optional(v.string()),
    pointLegacyId: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawQuoteSubmissions: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    episodeLegacyId: v.string(),
    seasonLegacyId: v.string(),
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
    pointLegacyId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawRankedListTypes: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    maxItems: v.number(),
    targetType: v.union(
      v.literal("MOVIE"),
      v.literal("SHOW"),
      v.literal("EPISODE"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawRankedLists: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    rankedListTypeLegacyId: v.string(),
    status: v.union(v.literal("DRAFT"), v.literal("PUBLISHED")),
    title: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawRankedItems: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    rankedListLegacyId: v.string(),
    movieLegacyId: v.optional(v.string()),
    showLegacyId: v.optional(v.string()),
    episodeLegacyId: v.optional(v.string()),
    rank: v.number(),
    comment: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawArchivePosts: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    postedAt: v.number(),
    content: v.string(),
    title: v.string(),
    episodeLegacyId: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),
});
