import {
  action as rawAction,
  internalAction as rawInternalAction,
  internalMutation as rawInternalMutation,
  internalQuery as rawInternalQuery,
  mutation as rawMutation,
  query as rawQuery,
} from "./_generated/server.js";
import { v } from "convex/values";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";

import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  requireAdminActor,
  requireServiceActor,
  requireUserActor,
} from "./lib/actors.js";
import {
  requireApplicationWritesEnabled,
  requireMigrationWritesEnabled,
} from "./lib/writeGate.js";

export const anonymousQuery = customQuery(
  rawQuery,
  customCtx(() => ({
    accessClass: "anonymous" as const,
    actor: null,
  })),
);

export const authenticatedQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({
    accessClass: "authenticated-owner" as const,
    actor: await requireUserActor(ctx),
  })),
);

export const adminQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({
    accessClass: "administrator" as const,
    actor: await requireAdminActor(ctx),
  })),
);

export const pipelineQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({
    accessClass: "pipeline-service" as const,
    actor: await requireServiceActor(ctx),
  })),
);

export const authenticatedMutation = customMutation(rawMutation, {
  args: { clientApiVersion: v.string() },
  input: async (ctx, { clientApiVersion }) => {
    const actor = await requireUserActor(ctx);
    const systemState = await requireApplicationWritesEnabled(ctx, {
      actor,
      clientApiVersion,
    });
    return {
      ctx: {
        accessClass: "authenticated-owner" as const,
        actor,
        systemState,
      },
      args: {},
    };
  },
});

export const adminMutation = customMutation(rawMutation, {
  args: { clientApiVersion: v.string() },
  input: async (ctx, { clientApiVersion }) => {
    const actor = await requireAdminActor(ctx);
    const systemState = await requireApplicationWritesEnabled(ctx, {
      actor,
      clientApiVersion,
    });
    return {
      ctx: {
        accessClass: "administrator" as const,
        actor,
        systemState,
      },
      args: {},
    };
  },
});

export const pipelineMutation = customMutation(rawMutation, {
  args: { clientApiVersion: v.string() },
  input: async (ctx, { clientApiVersion }) => {
    const actor = await requireServiceActor(ctx);
    const systemState = await requireApplicationWritesEnabled(ctx, {
      actor,
      clientApiVersion,
    });
    return {
      ctx: {
        accessClass: "pipeline-service" as const,
        actor,
        systemState,
      },
      args: {},
    };
  },
});

export const internalAppMutation = customMutation(rawInternalMutation, {
  args: {
    cutoverRunId: v.string(),
    clientApiVersion: v.string(),
  },
  input: async (ctx, { cutoverRunId, clientApiVersion }) => {
    const actor = {
      kind: "internal" as const,
      label: "scheduled-application-write",
    };
    const systemState = await requireApplicationWritesEnabled(ctx, {
      actor,
      clientApiVersion,
    });
    if (systemState.cutoverRunId !== cutoverRunId) {
      throw new Error("Scheduled write cutover run mismatch");
    }
    return {
      ctx: {
        accessClass: "internal-only" as const,
        actor,
        systemState,
      },
      args: {},
    };
  },
});

export const internalMigrationMutation = customMutation(
  rawInternalMutation,
  {
    args: {
      cutoverRunId: v.string(),
      operationId: v.string(),
    },
    input: async (ctx, args) => {
      const systemState = await requireMigrationWritesEnabled(ctx, args);
      return {
        ctx: {
          accessClass: "internal-only" as const,
          actor: {
            kind: "internal" as const,
            label: `migration:${args.operationId}`,
          },
          systemState,
          migrationOperationId: args.operationId,
        },
        args: {},
      };
    },
  },
);

export const authenticatedAction = customAction(rawAction, {
  args: { clientApiVersion: v.string() },
  input: async (ctx, { clientApiVersion }) => {
    const actor: {
      userId: Id<"users">;
      isAdmin: boolean;
    } = await ctx.runQuery(internal.identity.access.resolveUserForAction, {});
    const systemState: Doc<"systemState"> = await ctx.runMutation(
      internal.system.gate.assertUserActionWriteEnabled,
      {
        userId: actor.userId,
        clientApiVersion,
      },
    );
    return {
      ctx: {
        accessClass: "authenticated-owner" as const,
        actor,
        systemState,
      },
      args: {},
    };
  },
});

export const pipelineAction = customAction(rawAction, {
  args: { clientApiVersion: v.string() },
  input: async (ctx, { clientApiVersion }) => {
    const actor: {
      servicePrincipalId: Id<"servicePrincipals">;
      permissions: string[];
    } = await ctx.runQuery(
      internal.identity.access.resolveServiceForAction,
      {},
    );
    const systemState: Doc<"systemState"> = await ctx.runMutation(
      internal.system.gate.assertServiceActionWriteEnabled,
      {
        servicePrincipalId: actor.servicePrincipalId,
        clientApiVersion,
      },
    );
    return {
      ctx: {
        accessClass: "pipeline-service" as const,
        actor,
        systemState,
      },
      args: {},
    };
  },
});

export const internalControlMutation = rawInternalMutation;
export const internalReadQuery = rawInternalQuery;
export const internalReadAction = rawInternalAction;
