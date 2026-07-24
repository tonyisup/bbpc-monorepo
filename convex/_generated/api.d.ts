/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions from "../functions.js";
import type * as identity_access from "../identity/access.js";
import type * as identity_profile from "../identity/profile.js";
import type * as lib_actors from "../lib/actors.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_writeGate from "../lib/writeGate.js";
import type * as migration_catalog from "../migration/catalog.js";
import type * as migration_catalogReconciliation from "../migration/catalogReconciliation.js";
import type * as migration_constants from "../migration/constants.js";
import type * as migration_episodes from "../migration/episodes.js";
import type * as migration_identity from "../migration/identity.js";
import type * as migration_normalize from "../migration/normalize.js";
import type * as migration_runtime from "../migration/runtime.js";
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
  functions: typeof functions;
  "identity/access": typeof identity_access;
  "identity/profile": typeof identity_profile;
  "lib/actors": typeof lib_actors;
  "lib/audit": typeof lib_audit;
  "lib/errors": typeof lib_errors;
  "lib/validators": typeof lib_validators;
  "lib/writeGate": typeof lib_writeGate;
  "migration/catalog": typeof migration_catalog;
  "migration/catalogReconciliation": typeof migration_catalogReconciliation;
  "migration/constants": typeof migration_constants;
  "migration/episodes": typeof migration_episodes;
  "migration/identity": typeof migration_identity;
  "migration/normalize": typeof migration_normalize;
  "migration/runtime": typeof migration_runtime;
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
