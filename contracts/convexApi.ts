import { type FunctionReference, anyApi } from "convex/server";
import { type GenericId as Id } from "convex/values";

export const api: PublicApiType = anyApi as unknown as PublicApiType;
export const internal: InternalApiType = anyApi as unknown as InternalApiType;

export type PublicApiType = {
  identity: {
    profile: {
      actionGateProbe: FunctionReference<
        "action",
        "public",
        { clientApiVersion: string },
        {
          allowed: true;
          cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
          isAdmin: boolean;
        }
      >;
      me: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          email: string | null;
          id: Id<"users">;
          image: string | null;
          isAdmin: boolean;
          name: string | null;
        }
      >;
      updateMyName: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; name: string },
        { name: string; updatedAt: number }
      >;
    };
  };
  pipeline: {
    status: {
      actionGateProbe: FunctionReference<
        "action",
        "public",
        { clientApiVersion: string; requiredPermission: string },
        { allowed: true; cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4" }
      >;
      capabilities: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          name: string;
          permissions: Array<string>;
          servicePrincipalId: Id<"servicePrincipals">;
        }
      >;
      heartbeat: FunctionReference<
        "mutation",
        "public",
        { clientApiVersion: string; requiredPermission: string },
        { lastSeenAt: number }
      >;
    };
  };
  system: {
    cutover: {
      getStatus: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        | { applicationWriteMode: "disabled"; initialized: false }
        | {
            apiVersion: string;
            applicationWriteMode: "disabled" | "enabled";
            cutoverRunId: string;
            cutoverStage: "S0" | "S1" | "S2" | "S3" | "S4";
            firstApplicationWriteAt: number | null;
            initialized: true;
            updatedAt: number;
          }
      >;
    };
    health: {
      readiness: FunctionReference<
        "query",
        "public",
        Record<string, never>,
        {
          apiVersion: string;
          applicationWritesEnabled: boolean;
          initialized: boolean;
        }
      >;
    };
  };
};
export type InternalApiType = {};
