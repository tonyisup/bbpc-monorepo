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
