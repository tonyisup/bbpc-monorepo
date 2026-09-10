import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { api as backendApi } from "../convex/_generated/api.js";
import type { PublicApiType } from "./convexApi.js";

type Assert<T extends true> = T;

type CompatibleApi<Contract, Backend> =
  Contract extends FunctionReference<infer Kind>
    ? Backend extends FunctionReference<Kind>
      ? FunctionArgs<Contract> extends FunctionArgs<Backend>
        ? FunctionReturnType<Backend> extends FunctionReturnType<Contract>
          ? true
          : false
        : false
      : false
    : Exclude<keyof Backend, keyof Contract> extends never
      ? {
          [Key in keyof Contract]: Key extends keyof Backend
            ? CompatibleApi<Contract[Key], Backend[Key]>
            : false;
        }[keyof Contract] extends true ? true : false
      : false;

// The actual applications consume this contract: their arguments must be accepted
// by the backend and its results must fit their declared response types. Inferred
// backend results may be narrower than the exported runtime return validators.
export type ContractMatchesBackend = Assert<CompatibleApi<PublicApiType, typeof backendApi>>;
export type BackendIsTyped = Assert<0 extends 1 & typeof backendApi ? false : true>;
