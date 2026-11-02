import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalControlMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  getSystemState,
  requireApplicationWritesEnabled,
} from "../lib/writeGate.js";

// Rows removed per call; a restore's worth of links takes a few calls.
const RESET_BATCH_SIZE = 500;

/** Returns the issuer whose links belong to this deployment. */
function requireStagingAuthReset(batchId: string): string {
  if (
    process.env.BBPC_ENVIRONMENT !== "staging" ||
    process.env.CONVEX_CLOUD_URL !== "https://merry-shepherd-928.convex.cloud"
  ) {
    domainError("FORBIDDEN", "The auth reset is staging-only.");
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(batchId)) {
    domainError("VALIDATION_FAILED", "Supply a batch ID for the audit trail.");
  }
  const issuer = (process.env.CLERK_JWT_ISSUER_DOMAIN ?? "")
    .trim()
    .replace(/\/+$/u, "");
  // Stored issuers are a token's `iss`, an https origin. Any other form here
  // would make this deployment's own rows look foreign.
  if (!/^https:\/\/[^/\s]+$/u.test(issuer)) {
    domainError("FORBIDDEN", "The auth reset needs this deployment's issuer.");
  }
  return issuer;
}

/**
 * Deletes up to `limit` rows that another Clerk instance issued. Deleted rows
 * leave the index, so the next call starts where this one stopped.
 */
async function deleteForeignRows(
  ctx: MutationCtx,
  table: "authIdentities" | "servicePrincipals",
  issuer: string,
  limit: number,
): Promise<number> {
  if (limit === 0) return 0;
  const before = await ctx.db
    .query(table)
    .withIndex("by_issuer_and_subject", (index) => index.lt("issuer", issuer))
    .take(limit);
  const after =
    before.length === limit
      ? []
      : await ctx.db
          .query(table)
          .withIndex("by_issuer_and_subject", (index) =>
            index.gt("issuer", issuer),
          )
          .take(limit - before.length);
  for (const row of [...before, ...after]) {
    await ctx.db.delete(table, row._id);
  }
  return before.length + after.length;
}

/**
 * Makes a staging deployment restored from production usable for sign-in.
 *
 * A restore copies production's identity links, and a member whose account is
 * already linked cannot link the staging sign-in for the same email. This
 * removes every link and service principal that this deployment's issuer did
 * not issue, and every impersonation session. Members, roles and role
 * memberships stay, so the next staging sign-in links by verified email and
 * keeps its roles. It takes no arguments: the run ID and API version come from
 * the restored `systemState`, and the batch ID defaults to one per run. A run
 * that returns `done: false` schedules the rest itself; a repeat run changes
 * nothing.
 */
export const resetStagingAuth = internalControlMutation({
  args: { batchId: v.optional(v.string()) },
  returns: v.object({
    authIdentitiesDeleted: v.number(),
    servicePrincipalsDeleted: v.number(),
    impersonationSessionsDeleted: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchId = args.batchId ?? `staging-auth-reset-${String(Date.now())}`;
    const issuer = requireStagingAuthReset(batchId);
    const actor = { kind: "internal" as const, label: "staging-auth-reset" };
    // A missing state fails before the version is compared.
    const systemState = await requireApplicationWritesEnabled(ctx, {
      actor,
      clientApiVersion: (await getSystemState(ctx))?.apiVersion ?? "",
    });
    let remaining = RESET_BATCH_SIZE;
    const authIdentitiesDeleted = await deleteForeignRows(
      ctx,
      "authIdentities",
      issuer,
      remaining,
    );
    remaining -= authIdentitiesDeleted;
    const servicePrincipalsDeleted = await deleteForeignRows(
      ctx,
      "servicePrincipals",
      issuer,
      remaining,
    );
    remaining -= servicePrincipalsDeleted;
    // A session carried over from production would otherwise resume for the
    // administrator who started it as soon as that administrator signs in.
    const impersonationSessions =
      remaining === 0
        ? []
        : await ctx.db
            .query("impersonationSessions")
            .withIndex("by_actorUserId_and_startedAt")
            .take(remaining);
    for (const session of impersonationSessions) {
      await ctx.db.delete("impersonationSessions", session._id);
    }
    remaining -= impersonationSessions.length;

    if (remaining < RESET_BATCH_SIZE) {
      await writeAuditEvent(ctx, {
        actor,
        action: "identity.stagingAuthReset",
        targetType: "systemState",
        targetId: systemState._id,
        cutoverRunId: systemState.cutoverRunId,
        metadata: {
          batchId,
          authIdentitiesDeleted,
          servicePrincipalsDeleted,
          impersonationSessionsDeleted: impersonationSessions.length,
        },
      });
    }
    // A full batch may have left rows behind.
    const done = remaining > 0;
    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.identity.maintenance.resetStagingAuth,
        { batchId },
      );
    }
    return {
      authIdentitiesDeleted,
      servicePrincipalsDeleted,
      impersonationSessionsDeleted: impersonationSessions.length,
      done,
    };
  },
});
