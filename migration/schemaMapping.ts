export { SOURCE_SCHEMA_FINGERPRINT } from "../convex/migration/constants.js";

export type DomainOwner =
  | "archive"
  | "assignments"
  | "catalog"
  | "episodes"
  | "games"
  | "identity"
  | "rankings"
  | "reviews";

export type LegacyIdShape =
  | "composite"
  | "integer"
  | "string"
  | "uuid";

export interface SourceTableMapping {
  source: string;
  domain: DomainOwner;
  disposition: "migrate" | "retire";
  target: string | null;
  legacyIdShape: LegacyIdShape | null;
  decision: string;
}

export const sourceTableMappings = [
  {
    source: "Archive.Posts",
    domain: "archive",
    disposition: "migrate",
    target: "archivePosts",
    legacyIdShape: "integer",
    decision:
      "Preserve all archive rows and nullable episode linkage; the probe found no unresolved episode references, while product visibility remains pending approval.",
  },
  {
    source: "dbo.Account",
    domain: "identity",
    disposition: "retire",
    target: null,
    legacyIdShape: null,
    decision:
      "Retire Auth.js provider accounts; never extract or migrate provider tokens.",
  },
  {
    source: "dbo.Assignment",
    domain: "assignments",
    disposition: "migrate",
    target: "assignments",
    legacyIdShape: "uuid",
    decision:
      "Rename relationships to Convex IDs and preserve type, playable, and nullable slug.",
  },
  {
    source: "dbo.AssignmentPoints",
    domain: "assignments",
    disposition: "migrate",
    target: "assignmentPointLinks",
    legacyIdShape: "uuid",
    decision:
      "Preserve the explicit assignment, user, and point linkage.",
  },
  {
    source: "dbo.AssignmentReview",
    domain: "reviews",
    disposition: "migrate",
    target: "assignmentReviews",
    legacyIdShape: "uuid",
    decision: "Preserve the assignment-to-review join as a canonical document.",
  },
  {
    source: "dbo.AudioEpisodeMessage",
    domain: "episodes",
    disposition: "migrate",
    target: "episodeAudioMessages",
    legacyIdShape: "integer",
    decision:
      "Preserve metadata and external media URLs; media bytes remain in current storage.",
  },
  {
    source: "dbo.AudioMessage",
    domain: "assignments",
    disposition: "migrate",
    target: "assignmentAudioMessages",
    legacyIdShape: "integer",
    decision:
      "Preserve metadata and external media URLs; media bytes remain in current storage.",
  },
  {
    source: "dbo.Banger",
    domain: "episodes",
    disposition: "migrate",
    target: "bangers",
    legacyIdShape: "uuid",
    decision: "Preserve nullable episode and submitting-user relationships.",
  },
  {
    source: "dbo.Episode",
    domain: "episodes",
    disposition: "migrate",
    target: "episodes",
    legacyIdShape: "uuid",
    decision:
      "Preserve nullable calendar date, status, SEO fields, and unique nullable slug.",
  },
  {
    source: "dbo.ExtraReview",
    domain: "reviews",
    disposition: "migrate",
    target: "extraReviews",
    legacyIdShape: "uuid",
    decision: "Preserve the episode-to-review join as a canonical document.",
  },
  {
    source: "dbo.GamblingPoints",
    domain: "games",
    disposition: "migrate",
    target: "gamblingEntries",
    legacyIdShape: "uuid",
    decision:
      "Preserve wager state and optional assignment, award point, season, and target-user relationships.",
  },
  {
    source: "dbo.GamblingType",
    domain: "games",
    disposition: "migrate",
    target: "gamblingTypes",
    legacyIdShape: "uuid",
    decision:
      "Preserve multiplier as a finite number and enforce normalized lookup ID uniqueness.",
  },
  {
    source: "dbo.GamePointType",
    domain: "games",
    disposition: "migrate",
    target: "gamePointTypes",
    legacyIdShape: "integer",
    decision:
      "Preserve SQL smallint point values and enforce normalized lookup ID uniqueness.",
  },
  {
    source: "dbo.GameType",
    domain: "games",
    disposition: "migrate",
    target: "gameTypes",
    legacyIdShape: "integer",
    decision: "Enforce normalized lookup ID uniqueness.",
  },
  {
    source: "dbo.Guess",
    domain: "games",
    disposition: "migrate",
    target: "guesses",
    legacyIdShape: "uuid",
    decision:
      "Rename assignmntReviewId to assignmentReviewId and preserve optional award point.",
  },
  {
    source: "dbo.Link",
    domain: "episodes",
    disposition: "migrate",
    target: "episodeLinks",
    legacyIdShape: "uuid",
    decision: "Preserve nullable episode linkage and source ordering semantics.",
  },
  {
    source: "dbo.Movie",
    domain: "catalog",
    disposition: "migrate",
    target: "movies",
    legacyIdShape: "uuid",
    decision:
      "Preserve every row and legacy ID; title and URL duplicates are not merged.",
  },
  {
    source: "dbo.Point",
    domain: "games",
    disposition: "migrate",
    target: "points",
    legacyIdShape: "uuid",
    decision:
      "Preserve nullable adjustment distinctly from zero and validate SQL int bounds.",
  },
  {
    source: "dbo.QuoteSubmission",
    domain: "games",
    disposition: "migrate",
    target: "quoteSubmissions",
    legacyIdShape: "uuid",
    decision:
      "Preserve checks and enforce episode/user plus non-null point uniqueness transactionally.",
  },
  {
    source: "dbo.RankedItem",
    domain: "rankings",
    disposition: "migrate",
    target: "rankedItems",
    legacyIdShape: "uuid",
    decision:
      "Require exactly one movie/show/episode target and validate it against the ranked-list type; all probed source rows satisfy the one-target invariant.",
  },
  {
    source: "dbo.RankedList",
    domain: "rankings",
    disposition: "migrate",
    target: "rankedLists",
    legacyIdShape: "uuid",
    decision: "Preserve owner, type, status, title, and timestamps.",
  },
  {
    source: "dbo.RankedListType",
    domain: "rankings",
    disposition: "migrate",
    target: "rankedListTypes",
    legacyIdShape: "uuid",
    decision: "Preserve maxItems and targetType for canonical validation.",
  },
  {
    source: "dbo.Rating",
    domain: "reviews",
    disposition: "migrate",
    target: "ratings",
    legacyIdShape: "uuid",
    decision: "Preserve SQL tinyint values and optional presentation metadata.",
  },
  {
    source: "dbo.Review",
    domain: "reviews",
    disposition: "migrate",
    target: "reviews",
    legacyIdShape: "uuid",
    decision:
      "Recommend reviewedAt = reviewedOn ?? ReviewdOn; the probe found no conflicting non-null values.",
  },
  {
    source: "dbo.Role",
    domain: "identity",
    disposition: "migrate",
    target: "roles",
    legacyIdShape: "integer",
    decision:
      "Preserve role identity/admin flag and add canonical normalized name and permissions.",
  },
  {
    source: "dbo.Season",
    domain: "games",
    disposition: "migrate",
    target: "seasons",
    legacyIdShape: "uuid",
    decision:
      "Preserve startedOn and endedOn as nullable YYYY-MM-DD calendar strings.",
  },
  {
    source: "dbo.Session",
    domain: "identity",
    disposition: "retire",
    target: null,
    legacyIdShape: null,
    decision:
      "Retire Auth.js sessions; force Clerk reauthentication and never migrate session tokens.",
  },
  {
    source: "dbo.Show",
    domain: "catalog",
    disposition: "migrate",
    target: "shows",
    legacyIdShape: "uuid",
    decision: "Preserve every row and legacy ID without title or URL merging.",
  },
  {
    source: "dbo.Syllabus",
    domain: "assignments",
    disposition: "migrate",
    target: "syllabusEntries",
    legacyIdShape: "uuid",
    decision:
      "Preserve owner-scoped order and optional assignment/notes relationships.",
  },
  {
    source: "dbo.Tag",
    domain: "catalog",
    disposition: "migrate",
    target: "tags",
    legacyIdShape: "uuid",
    decision:
      "Preserve display name and enforce uniqueness through a normalized name key.",
  },
  {
    source: "dbo.TagVote",
    domain: "games",
    disposition: "migrate",
    target: "tagVotes",
    legacyIdShape: "uuid",
    decision:
      "Map unresolved legacy point UUIDs to legacyAwardTombstone so awards cannot repeat.",
  },
  {
    source: "dbo.User",
    domain: "identity",
    disposition: "migrate",
    target: "users",
    legacyIdShape: "string",
    decision:
      "Preserve canonical profiles and legacy email verification time; all 19 normalized email candidates are unique. Retire active impersonation state and link Clerk only through audited identity flows.",
  },
  {
    source: "dbo.UserRole",
    domain: "identity",
    disposition: "migrate",
    target: "userRoles",
    legacyIdShape: "uuid",
    decision: "Preserve role assignments and reject duplicate canonical links.",
  },
  {
    source: "dbo.VerificationToken",
    domain: "identity",
    disposition: "retire",
    target: null,
    legacyIdShape: null,
    decision:
      "Retire Auth.js verification tokens; never extract or migrate token values.",
  },
] as const satisfies readonly SourceTableMapping[];

export const requiredIndexesByTarget = {
  archivePosts: ["by_legacyId", "by_episodeId_and_postedAt"],
  users: ["by_legacyId", "by_normalizedEmail", "by_status"],
  roles: ["by_legacyId", "by_normalizedName"],
  userRoles: [
    "by_legacyId",
    "by_userId",
    "by_roleId",
    "by_userId_and_roleId",
  ],
  episodes: [
    "by_legacyId",
    "by_number",
    "by_slug",
    "by_normalizedSlug",
    "by_date_and_status",
  ],
  episodeLinks: ["by_legacyId", "by_episodeId"],
  bangers: ["by_legacyId", "by_episodeId", "by_userId"],
  episodeAudioMessages: [
    "by_legacyId",
    "by_episodeId",
    "by_userId",
  ],
  movies: [
    "by_legacyId",
    "by_tmdbId",
    "by_normalizedTitle_and_year",
  ],
  shows: ["by_legacyId", "by_normalizedTitle_and_year"],
  tags: ["by_legacyId", "by_normalizedName"],
  assignments: [
    "by_legacyId",
    "by_userId",
    "by_episodeId",
    "by_movieId",
    "by_slug",
  ],
  assignmentAudioMessages: [
    "by_legacyId",
    "by_assignmentId",
    "by_userId",
  ],
  assignmentPointLinks: [
    "by_legacyId",
    "by_assignmentId",
    "by_userId",
    "by_pointId",
  ],
  syllabusEntries: [
    "by_legacyId",
    "by_userId_and_order",
    "by_movieId",
    "by_assignmentId",
  ],
  ratings: ["by_legacyId", "by_value"],
  reviews: [
    "by_legacyId",
    "by_userId",
    "by_movieId",
    "by_showId",
    "by_ratingId",
  ],
  assignmentReviews: [
    "by_legacyId",
    "by_assignmentId",
    "by_reviewId",
  ],
  extraReviews: ["by_legacyId", "by_episodeId", "by_reviewId"],
  gameTypes: ["by_legacyId", "by_normalizedLookupId"],
  gamePointTypes: [
    "by_legacyId",
    "by_normalizedLookupId",
    "by_gameTypeId",
  ],
  seasons: ["by_legacyId", "by_gameTypeId", "by_startedOn"],
  points: [
    "by_legacyId",
    "by_userId",
    "by_seasonId",
    "by_gamePointTypeId",
    "by_userId_and_seasonId",
  ],
  guesses: [
    "by_legacyId",
    "by_userId",
    "by_assignmentReviewId",
    "by_seasonId",
    "by_pointId",
    "by_userId_and_assignmentReviewId",
  ],
  gamblingTypes: ["by_legacyId", "by_normalizedLookupId"],
  gamblingEntries: [
    "by_legacyId",
    "by_userId",
    "by_assignmentId",
    "by_awardPointId",
    "by_seasonId",
    "by_gamblingTypeId",
    "by_targetUserId",
    "by_userId_and_seasonId",
  ],
  tagVotes: [
    "by_legacyId",
    "by_userId",
    "by_normalizedTag_and_userId",
    "by_tmdbId_and_normalizedTag",
  ],
  quoteSubmissions: [
    "by_legacyId",
    "by_episodeId_and_status",
    "by_episodeId_and_userId",
    "by_seasonId",
    "by_userId",
    "by_pointId",
  ],
  rankedListTypes: ["by_legacyId"],
  rankedLists: [
    "by_legacyId",
    "by_userId",
    "by_rankedListTypeId",
    "by_userId_and_rankedListTypeId",
  ],
  rankedItems: [
    "by_legacyId",
    "by_rankedListId_and_rank",
    "by_movieId",
    "by_showId",
    "by_episodeId",
  ],
} as const satisfies Record<string, readonly string[]>;

export const pendingDomainDecisions = [
  {
    id: "sql-datetime-timezone",
    scope: "All SQL datetime/datetime2 columns",
    recommendation:
      "Interpret legacy wall-clock values as UTC and convert directly to epoch milliseconds.",
    evidence:
      "The guarded dev clone reported zero server and GETDATE-to-GETUTCDATE offsets; Azure SQL Database is documented to follow UTC.",
    question:
      "Approve UTC as the source timezone for legacy wall-clock timestamps.",
  },
  {
    id: "review-timestamp-precedence",
    scope: "dbo.Review.ReviewdOn and dbo.Review.reviewedOn",
    recommendation: "Set reviewedAt to reviewedOn ?? ReviewdOn.",
    evidence:
      "Of 989 rows, 528 values match, 120 have only ReviewdOn, 341 have neither, and none conflict or have only reviewedOn.",
    question:
      "Approve the canonical reviewedAt precedence rule while retaining both source values only in private reconciliation evidence.",
  },
  {
    id: "normalized-text-rule",
    scope: "Case-insensitive unique and lookup text",
    recommendation:
      "Trim, normalize with Unicode NFKC, then lowercase without locale-specific rules; fail on any collision.",
    evidence:
      "SQL trim/lower normalization preserved distinct cardinality and found no blanks in all five probed lookup tables.",
    question:
      "Approve trim plus Unicode NFKC plus locale-independent lowercasing as the Convex normalized-key rule.",
  },
  {
    id: "archive-posts-visibility",
    scope: "Archive.Posts",
    recommendation:
      "Migrate all rows, preserve nullable episode linkage, and keep reads disabled unless the product explicitly needs them.",
    evidence:
      "All 433 rows are structurally migratable: 327 link to episodes, 106 are intentionally unlinked, and none have unresolved episode references.",
    question:
      "Confirm whether archive posts remain queryable product data or backup-only retained records after cutover.",
  },
] as const;
