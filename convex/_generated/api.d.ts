/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as favorites from "../favorites.js";
import type * as manifests from "../manifests.js";
import type * as recordings from "../recordings.js";
import type * as rtc from "../rtc.js";
import type * as segmentTemplates from "../segmentTemplates.js";
import type * as sessions from "../sessions.js";
import type * as sounders from "../sounders.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  favorites: typeof favorites;
  manifests: typeof manifests;
  recordings: typeof recordings;
  rtc: typeof rtc;
  segmentTemplates: typeof segmentTemplates;
  sessions: typeof sessions;
  sounders: typeof sounders;
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
