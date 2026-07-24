export const SOURCE_SCHEMA_FINGERPRINT =
  "5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a";

export const IDENTITY_OPERATIONS = {
  start: "identity.start",
  users: "identity.users",
  roles: "identity.roles",
  userRoles: "identity.userRoles",
  finish: "identity.finish",
} as const;

export const IDENTITY_RECONCILIATION_OPERATIONS = {
  users: "identity.reconcile.users",
  roles: "identity.reconcile.roles",
  userRoles: "identity.reconcile.userRoles",
  finish: "identity.reconcile.finish",
} as const;

export const CATALOG_OPERATIONS = {
  start: "catalog.start",
  movies: "catalog.movies",
  shows: "catalog.shows",
  tags: "catalog.tags",
  finish: "catalog.finish",
} as const;

export const CATALOG_RECONCILIATION_OPERATIONS = {
  movies: "catalog.reconcile.movies",
  shows: "catalog.reconcile.shows",
  tags: "catalog.reconcile.tags",
  finish: "catalog.reconcile.finish",
} as const;

export const EPISODE_OPERATIONS = {
  start: "episodes.start",
  episodes: "episodes.episodes",
  links: "episodes.links",
  bangers: "episodes.bangers",
  audioMessages: "episodes.audioMessages",
  finish: "episodes.finish",
} as const;

export const EPISODE_RECONCILIATION_OPERATIONS = {
  episodes: "episodes.reconcile.episodes",
  links: "episodes.reconcile.links",
  bangers: "episodes.reconcile.bangers",
  audioMessages: "episodes.reconcile.audioMessages",
  finish: "episodes.reconcile.finish",
} as const;

export const ARCHIVE_OPERATIONS = {
  start: "archive.start",
  posts: "archive.posts",
  finish: "archive.finish",
} as const;

export const ARCHIVE_RECONCILIATION_OPERATIONS = {
  posts: "archive.reconcile.posts",
  finish: "archive.reconcile.finish",
} as const;

export const ASSIGNMENT_OPERATIONS = {
  start: "assignments.start",
  assignments: "assignments.assignments",
  audioMessages: "assignments.audioMessages",
  syllabusEntries: "assignments.syllabusEntries",
  pointLinks: "assignments.pointLinks",
  finish: "assignments.finish",
} as const;

export const ASSIGNMENT_RECONCILIATION_OPERATIONS = {
  assignments: "assignments.reconcile.assignments",
  audioMessages: "assignments.reconcile.audioMessages",
  syllabusEntries: "assignments.reconcile.syllabusEntries",
  pointLinks: "assignments.reconcile.pointLinks",
  finish: "assignments.reconcile.finish",
} as const;

export const GAME_OPERATIONS = {
  start: "games.start",
  gameTypes: "games.gameTypes",
  gamePointTypes: "games.gamePointTypes",
  seasons: "games.seasons",
  points: "games.points",
  guesses: "games.guesses",
  gamblingTypes: "games.gamblingTypes",
  gamblingEntries: "games.gamblingEntries",
  tagVotes: "games.tagVotes",
  quoteSubmissions: "games.quoteSubmissions",
  finish: "games.finish",
} as const;

export const GAME_RECONCILIATION_OPERATIONS = {
  gameTypes: "games.reconcile.gameTypes",
  gamePointTypes: "games.reconcile.gamePointTypes",
  seasons: "games.reconcile.seasons",
  points: "games.reconcile.points",
  guesses: "games.reconcile.guesses",
  gamblingTypes: "games.reconcile.gamblingTypes",
  gamblingEntries: "games.reconcile.gamblingEntries",
  tagVotes: "games.reconcile.tagVotes",
  quoteSubmissions: "games.reconcile.quoteSubmissions",
  finish: "games.reconcile.finish",
} as const;

export const RANKING_OPERATIONS = {
  start: "rankings.start",
  listTypes: "rankings.listTypes",
  lists: "rankings.lists",
  items: "rankings.items",
  finish: "rankings.finish",
} as const;

export const RANKING_RECONCILIATION_OPERATIONS = {
  listTypes: "rankings.reconcile.listTypes",
  lists: "rankings.reconcile.lists",
  items: "rankings.reconcile.items",
  finish: "rankings.reconcile.finish",
} as const;

export const REVIEW_OPERATIONS = {
  start: "reviews.start",
  ratings: "reviews.ratings",
  reviews: "reviews.reviews",
  assignmentReviews: "reviews.assignmentReviews",
  extraReviews: "reviews.extraReviews",
  finish: "reviews.finish",
} as const;

export const REVIEW_RECONCILIATION_OPERATIONS = {
  ratings: "reviews.reconcile.ratings",
  reviews: "reviews.reconcile.reviews",
  assignmentReviews: "reviews.reconcile.assignmentReviews",
  extraReviews: "reviews.reconcile.extraReviews",
  finish: "reviews.reconcile.finish",
} as const;

export const FOUNDATION_SCRUB_SCOPE = "foundation-v1";

export const FOUNDATION_SCRUB_OPERATIONS = {
  start: "scrub.foundation.start",
  identity: "scrub.foundation.identityRaw",
  catalog: "scrub.foundation.catalogRaw",
  episodes: "scrub.foundation.episodeRaw",
  checkpoints: "scrub.foundation.checkpoints",
  finish: "scrub.foundation.finish",
} as const;
