/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as episodes_public from "../episodes/public.js";
import type * as episodes_readModel from "../episodes/readModel.js";
import type * as episodes_validators from "../episodes/validators.js";
import type * as functions from "../functions.js";
import type * as identity_access from "../identity/access.js";
import type * as identity_profile from "../identity/profile.js";
import type * as lib_actors from "../lib/actors.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_normalize from "../lib/normalize.js";
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
import type * as system_cutover from "../system/cutover.js";
import type * as system_gate from "../system/gate.js";
import type * as system_health from "../system/health.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "episodes/public": typeof episodes_public;
  "episodes/readModel": typeof episodes_readModel;
  "episodes/validators": typeof episodes_validators;
  functions: typeof functions;
  "identity/access": typeof identity_access;
  "identity/profile": typeof identity_profile;
  "lib/actors": typeof lib_actors;
  "lib/audit": typeof lib_audit;
  "lib/errors": typeof lib_errors;
  "lib/normalize": typeof lib_normalize;
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
