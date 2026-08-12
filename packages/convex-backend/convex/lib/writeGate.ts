import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import type { ApplicationActor } from "./actors.js";
import { actorLabel } from "./actors.js";
import { writeAuditEvent } from "./audit.js";
import { domainError } from "./errors.js";

type ReadContext = Pick<QueryCtx, "db">;

export async function getSystemState(
  ctx: ReadContext,
): Promise<Doc<"systemState"> | null> {
  return await ctx.db
    .query("systemState")
    .withIndex("by_singletonKey", (query) =>
      query.eq("singletonKey", "global"),
    )
    .unique();
}

function assertMatchingVersion(
  state: Doc<"systemState">,
  clientApiVersion: string,
): void {
  if (state.apiVersion !== clientApiVersion) {
    domainError(
      "STALE_CLIENT",
      "This BBPC client version can no longer write. Refresh or update and try again.",
      {
        details: {
          expectedApiVersion: state.apiVersion,
          receivedApiVersion: clientApiVersion,
        },
      },
    );
  }
}

export async function requireApplicationWritesEnabled(
  ctx: MutationCtx,
  input: {
    actor: ApplicationActor;
    clientApiVersion: string;
  },
): Promise<Doc<"systemState">> {
  const state = await getSystemState(ctx);
  if (!state) {
    domainError(
      "WRITE_DISABLED",
      "BBPC writes are disabled until the backend is initialized.",
      { retryable: true },
    );
  }
  assertMatchingVersion(state, input.clientApiVersion);
  if (
    state.applicationWriteMode !== "enabled" ||
    (state.cutoverStage !== "S3" && state.cutoverStage !== "S4")
  ) {
    domainError(
      "WRITE_DISABLED",
      "BBPC is currently read-only.",
      {
        retryable: true,
        details: { cutoverStage: state.cutoverStage },
      },
    );
  }

  if (state.firstApplicationWriteAt === undefined) {
    const acceptedAt = Date.now();
    await ctx.db.patch("systemState", state._id, {
      firstApplicationWriteAt: acceptedAt,
      updatedAt: acceptedAt,
      updatedBy: actorLabel(input.actor),
    });
    await writeAuditEvent(ctx, {
      actor: input.actor,
      action: "system.firstApplicationWrite",
      targetType: "systemState",
      targetId: state._id,
      cutoverRunId: state.cutoverRunId,
      metadata: { cutoverStage: state.cutoverStage },
    });
  }

  return state;
}

export async function requireMigrationWritesEnabled(
  ctx: MutationCtx,
  input: {
    cutoverRunId: string;
    operationId: string;
  },
): Promise<Doc<"systemState">> {
  const state = await getSystemState(ctx);
  if (!state) {
    domainError(
      "WRITE_DISABLED",
      "Migration writes are disabled until the backend is initialized.",
    );
  }
  if (state.cutoverRunId !== input.cutoverRunId) {
    domainError(
      "CONFLICT",
      "The migration run does not match the initialized cutover run.",
    );
  }
  if (
    state.applicationWriteMode !== "disabled" ||
    (state.cutoverStage !== "S1" && state.cutoverStage !== "S2")
  ) {
    domainError(
      "WRITE_DISABLED",
      "Migration writes are allowed only in S1 or S2 while application writes are disabled.",
      { details: { operationId: input.operationId } },
    );
  }
  return state;
}
