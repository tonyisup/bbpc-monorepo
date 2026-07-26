import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import type { ApplicationActor } from "./actors.js";

type AuditMetadataValue = string | number | boolean | null;

interface WriteAuditEventInput {
  actor: ApplicationActor;
  action: string;
  targetType: string;
  targetId?: string;
  cutoverRunId?: string;
  impersonationSessionId?: Doc<"impersonationSessions">["_id"];
  metadata?: Record<string, AuditMetadataValue>;
}

export async function writeAuditEvent(
  ctx: MutationCtx,
  input: WriteAuditEventInput,
): Promise<void> {
  const impersonationSessionId =
    input.impersonationSessionId ??
    (input.actor.kind === "user"
      ? input.actor.impersonationSession?._id
      : undefined);
  const common = {
    action: input.action,
    targetType: input.targetType,
    createdAt: Date.now(),
    ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
    ...(input.cutoverRunId === undefined
      ? {}
      : { cutoverRunId: input.cutoverRunId }),
    ...(impersonationSessionId === undefined
      ? {}
      : { impersonationSessionId }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };

  switch (input.actor.kind) {
    case "user":
      await ctx.db.insert("auditEvents", {
        ...common,
        actorType: "user",
        actorUserId: input.actor.authenticatedUser._id,
      });
      break;
    case "service":
      await ctx.db.insert("auditEvents", {
        ...common,
        actorType: "service",
        servicePrincipalId: input.actor.servicePrincipal._id,
      });
      break;
    case "internal":
      await ctx.db.insert("auditEvents", {
        ...common,
        actorType: "internal",
      });
      break;
  }
}

export async function writeControlAuditEvent(
  ctx: MutationCtx,
  input: {
    actor: string;
    action: string;
    targetType: string;
    targetId?: string;
    cutoverRunId?: string;
    metadata?: Record<string, AuditMetadataValue>;
  },
): Promise<void> {
  await ctx.db.insert("auditEvents", {
    actorType: "control",
    action: input.action,
    targetType: input.targetType,
    createdAt: Date.now(),
    metadata: {
      actor: input.actor,
      ...(input.metadata ?? {}),
    },
    ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
    ...(input.cutoverRunId === undefined
      ? {}
      : { cutoverRunId: input.cutoverRunId }),
  });
}
