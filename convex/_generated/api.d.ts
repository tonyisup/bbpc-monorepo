/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_dashboard from "../admin/dashboard.js";
import type * as admin_limits from "../admin/limits.js";
import type * as admin_validators from "../admin/validators.js";
import type * as assignments_admin from "../assignments/admin.js";
import type * as assignments_limits from "../assignments/limits.js";
import type * as assignments_public from "../assignments/public.js";
import type * as assignments_readModel from "../assignments/readModel.js";
import type * as assignments_validators from "../assignments/validators.js";
import type * as assignments_writeModel from "../assignments/writeModel.js";
import type * as catalog_admin from "../catalog/admin.js";
import type * as catalog_external from "../catalog/external.js";
import type * as catalog_limits from "../catalog/limits.js";
import type * as catalog_operations from "../catalog/operations.js";
import type * as catalog_public from "../catalog/public.js";
import type * as catalog_readModel from "../catalog/readModel.js";
import type * as catalog_tmdbClient from "../catalog/tmdbClient.js";
import type * as catalog_validators from "../catalog/validators.js";
import type * as catalog_write from "../catalog/write.js";
import type * as catalog_writeModel from "../catalog/writeModel.js";
import type * as episodes_admin from "../episodes/admin.js";
import type * as episodes_adminWriteModel from "../episodes/adminWriteModel.js";
import type * as episodes_audio from "../episodes/audio.js";
import type * as episodes_bangers from "../episodes/bangers.js";
import type * as episodes_limits from "../episodes/limits.js";
import type * as episodes_public from "../episodes/public.js";
import type * as episodes_publicResults from "../episodes/publicResults.js";
import type * as episodes_readModel from "../episodes/readModel.js";
import type * as episodes_validators from "../episodes/validators.js";
import type * as functions from "../functions.js";
import type * as games_config from "../games/config.js";
import type * as games_gambling from "../games/gambling.js";
import type * as games_gamblingReadModel from "../games/gamblingReadModel.js";
import type * as games_gamblingWriteModel from "../games/gamblingWriteModel.js";
import type * as games_guessReadModel from "../games/guessReadModel.js";
import type * as games_guessWriteModel from "../games/guessWriteModel.js";
import type * as games_guesses from "../games/guesses.js";
import type * as games_limits from "../games/limits.js";
import type * as games_member from "../games/member.js";
import type * as games_pointReadModel from "../games/pointReadModel.js";
import type * as games_pointWriteModel from "../games/pointWriteModel.js";
import type * as games_points from "../games/points.js";
import type * as games_public from "../games/public.js";
import type * as games_quoteReadModel from "../games/quoteReadModel.js";
import type * as games_quoteWriteModel from "../games/quoteWriteModel.js";
import type * as games_quotes from "../games/quotes.js";
import type * as games_readModel from "../games/readModel.js";
import type * as games_seasons from "../games/seasons.js";
import type * as games_tagReadModel from "../games/tagReadModel.js";
import type * as games_tagWriteModel from "../games/tagWriteModel.js";
import type * as games_tags from "../games/tags.js";
import type * as games_validators from "../games/validators.js";
import type * as games_writeModel from "../games/writeModel.js";
import type * as identity_access from "../identity/access.js";
import type * as identity_admin from "../identity/admin.js";
import type * as identity_adminWriteModel from "../identity/adminWriteModel.js";
import type * as identity_limits from "../identity/limits.js";
import type * as identity_linking from "../identity/linking.js";
import type * as identity_linkingWriteModel from "../identity/linkingWriteModel.js";
import type * as identity_profile from "../identity/profile.js";
import type * as identity_provisioning from "../identity/provisioning.js";
import type * as identity_provisioningWriteModel from "../identity/provisioningWriteModel.js";
import type * as identity_public from "../identity/public.js";
import type * as identity_readModel from "../identity/readModel.js";
import type * as identity_roles from "../identity/roles.js";
import type * as identity_validators from "../identity/validators.js";
import type * as lib_actors from "../lib/actors.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_publicSearch from "../lib/publicSearch.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_writeGate from "../lib/writeGate.js";
import type * as migration_archive from "../migration/archive.js";
import type * as migration_archiveReconciliation from "../migration/archiveReconciliation.js";
import type * as migration_assignmentReconciliation from "../migration/assignmentReconciliation.js";
import type * as migration_assignments from "../migration/assignments.js";
import type * as migration_catalog from "../migration/catalog.js";
import type * as migration_catalogReconciliation from "../migration/catalogReconciliation.js";
import type * as migration_constants from "../migration/constants.js";
import type * as migration_episodeReconciliation from "../migration/episodeReconciliation.js";
import type * as migration_episodes from "../migration/episodes.js";
import type * as migration_gameFoundation from "../migration/gameFoundation.js";
import type * as migration_gameReconciliation from "../migration/gameReconciliation.js";
import type * as migration_gameRelationships from "../migration/gameRelationships.js";
import type * as migration_identity from "../migration/identity.js";
import type * as migration_identityReconciliation from "../migration/identityReconciliation.js";
import type * as migration_normalize from "../migration/normalize.js";
import type * as migration_rankingReconciliation from "../migration/rankingReconciliation.js";
import type * as migration_rankings from "../migration/rankings.js";
import type * as migration_rehearsal from "../migration/rehearsal.js";
import type * as migration_reviewReconciliation from "../migration/reviewReconciliation.js";
import type * as migration_reviews from "../migration/reviews.js";
import type * as migration_runtime from "../migration/runtime.js";
import type * as migration_scrub from "../migration/scrub.js";
import type * as pipeline_status from "../pipeline/status.js";
import type * as rankings_items from "../rankings/items.js";
import type * as rankings_lists from "../rankings/lists.js";
import type * as rankings_readModel from "../rankings/readModel.js";
import type * as rankings_types from "../rankings/types.js";
import type * as rankings_validators from "../rankings/validators.js";
import type * as rankings_writeModel from "../rankings/writeModel.js";
import type * as ratings_admin from "../ratings/admin.js";
import type * as ratings_limits from "../ratings/limits.js";
import type * as ratings_public from "../ratings/public.js";
import type * as ratings_readModel from "../ratings/readModel.js";
import type * as ratings_validators from "../ratings/validators.js";
import type * as ratings_writeModel from "../ratings/writeModel.js";
import type * as reviews_admin from "../reviews/admin.js";
import type * as reviews_limits from "../reviews/limits.js";
import type * as reviews_mine from "../reviews/mine.js";
import type * as reviews_public from "../reviews/public.js";
import type * as reviews_readModel from "../reviews/readModel.js";
import type * as reviews_validators from "../reviews/validators.js";
import type * as reviews_writeModel from "../reviews/writeModel.js";
import type * as syllabus_admin from "../syllabus/admin.js";
import type * as syllabus_limits from "../syllabus/limits.js";
import type * as syllabus_mine from "../syllabus/mine.js";
import type * as syllabus_readModel from "../syllabus/readModel.js";
import type * as syllabus_validators from "../syllabus/validators.js";
import type * as syllabus_writeModel from "../syllabus/writeModel.js";
import type * as system_cutover from "../system/cutover.js";
import type * as system_gate from "../system/gate.js";
import type * as system_health from "../system/health.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/dashboard": typeof admin_dashboard;
  "admin/limits": typeof admin_limits;
  "admin/validators": typeof admin_validators;
  "assignments/admin": typeof assignments_admin;
  "assignments/limits": typeof assignments_limits;
  "assignments/public": typeof assignments_public;
  "assignments/readModel": typeof assignments_readModel;
  "assignments/validators": typeof assignments_validators;
  "assignments/writeModel": typeof assignments_writeModel;
  "catalog/admin": typeof catalog_admin;
  "catalog/external": typeof catalog_external;
  "catalog/limits": typeof catalog_limits;
  "catalog/operations": typeof catalog_operations;
  "catalog/public": typeof catalog_public;
  "catalog/readModel": typeof catalog_readModel;
  "catalog/tmdbClient": typeof catalog_tmdbClient;
  "catalog/validators": typeof catalog_validators;
  "catalog/write": typeof catalog_write;
  "catalog/writeModel": typeof catalog_writeModel;
  "episodes/admin": typeof episodes_admin;
  "episodes/adminWriteModel": typeof episodes_adminWriteModel;
  "episodes/audio": typeof episodes_audio;
  "episodes/bangers": typeof episodes_bangers;
  "episodes/limits": typeof episodes_limits;
  "episodes/public": typeof episodes_public;
  "episodes/publicResults": typeof episodes_publicResults;
  "episodes/readModel": typeof episodes_readModel;
  "episodes/validators": typeof episodes_validators;
  functions: typeof functions;
  "games/config": typeof games_config;
  "games/gambling": typeof games_gambling;
  "games/gamblingReadModel": typeof games_gamblingReadModel;
  "games/gamblingWriteModel": typeof games_gamblingWriteModel;
  "games/guessReadModel": typeof games_guessReadModel;
  "games/guessWriteModel": typeof games_guessWriteModel;
  "games/guesses": typeof games_guesses;
  "games/limits": typeof games_limits;
  "games/member": typeof games_member;
  "games/pointReadModel": typeof games_pointReadModel;
  "games/pointWriteModel": typeof games_pointWriteModel;
  "games/points": typeof games_points;
  "games/public": typeof games_public;
  "games/quoteReadModel": typeof games_quoteReadModel;
  "games/quoteWriteModel": typeof games_quoteWriteModel;
  "games/quotes": typeof games_quotes;
  "games/readModel": typeof games_readModel;
  "games/seasons": typeof games_seasons;
  "games/tagReadModel": typeof games_tagReadModel;
  "games/tagWriteModel": typeof games_tagWriteModel;
  "games/tags": typeof games_tags;
  "games/validators": typeof games_validators;
  "games/writeModel": typeof games_writeModel;
  "identity/access": typeof identity_access;
  "identity/admin": typeof identity_admin;
  "identity/adminWriteModel": typeof identity_adminWriteModel;
  "identity/limits": typeof identity_limits;
  "identity/linking": typeof identity_linking;
  "identity/linkingWriteModel": typeof identity_linkingWriteModel;
  "identity/profile": typeof identity_profile;
  "identity/provisioning": typeof identity_provisioning;
  "identity/provisioningWriteModel": typeof identity_provisioningWriteModel;
  "identity/public": typeof identity_public;
  "identity/readModel": typeof identity_readModel;
  "identity/roles": typeof identity_roles;
  "identity/validators": typeof identity_validators;
  "lib/actors": typeof lib_actors;
  "lib/audit": typeof lib_audit;
  "lib/errors": typeof lib_errors;
  "lib/normalize": typeof lib_normalize;
  "lib/publicSearch": typeof lib_publicSearch;
  "lib/validators": typeof lib_validators;
  "lib/writeGate": typeof lib_writeGate;
  "migration/archive": typeof migration_archive;
  "migration/archiveReconciliation": typeof migration_archiveReconciliation;
  "migration/assignmentReconciliation": typeof migration_assignmentReconciliation;
  "migration/assignments": typeof migration_assignments;
  "migration/catalog": typeof migration_catalog;
  "migration/catalogReconciliation": typeof migration_catalogReconciliation;
  "migration/constants": typeof migration_constants;
  "migration/episodeReconciliation": typeof migration_episodeReconciliation;
  "migration/episodes": typeof migration_episodes;
  "migration/gameFoundation": typeof migration_gameFoundation;
  "migration/gameReconciliation": typeof migration_gameReconciliation;
  "migration/gameRelationships": typeof migration_gameRelationships;
  "migration/identity": typeof migration_identity;
  "migration/identityReconciliation": typeof migration_identityReconciliation;
  "migration/normalize": typeof migration_normalize;
  "migration/rankingReconciliation": typeof migration_rankingReconciliation;
  "migration/rankings": typeof migration_rankings;
  "migration/rehearsal": typeof migration_rehearsal;
  "migration/reviewReconciliation": typeof migration_reviewReconciliation;
  "migration/reviews": typeof migration_reviews;
  "migration/runtime": typeof migration_runtime;
  "migration/scrub": typeof migration_scrub;
  "pipeline/status": typeof pipeline_status;
  "rankings/items": typeof rankings_items;
  "rankings/lists": typeof rankings_lists;
  "rankings/readModel": typeof rankings_readModel;
  "rankings/types": typeof rankings_types;
  "rankings/validators": typeof rankings_validators;
  "rankings/writeModel": typeof rankings_writeModel;
  "ratings/admin": typeof ratings_admin;
  "ratings/limits": typeof ratings_limits;
  "ratings/public": typeof ratings_public;
  "ratings/readModel": typeof ratings_readModel;
  "ratings/validators": typeof ratings_validators;
  "ratings/writeModel": typeof ratings_writeModel;
  "reviews/admin": typeof reviews_admin;
  "reviews/limits": typeof reviews_limits;
  "reviews/mine": typeof reviews_mine;
  "reviews/public": typeof reviews_public;
  "reviews/readModel": typeof reviews_readModel;
  "reviews/validators": typeof reviews_validators;
  "reviews/writeModel": typeof reviews_writeModel;
  "syllabus/admin": typeof syllabus_admin;
  "syllabus/limits": typeof syllabus_limits;
  "syllabus/mine": typeof syllabus_mine;
  "syllabus/readModel": typeof syllabus_readModel;
  "syllabus/validators": typeof syllabus_validators;
  "syllabus/writeModel": typeof syllabus_writeModel;
  "system/cutover": typeof system_cutover;
  "system/gate": typeof system_gate;
  "system/health": typeof system_health;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
