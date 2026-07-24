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
  points: "games.points",
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
