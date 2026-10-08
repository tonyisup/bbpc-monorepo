import { v } from "convex/values";

import type { MutationCtx } from "../_generated/server.js";
import { internalAppMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";

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
 * keeps its roles. Run it until `done` is true; a repeat run changes nothing.
 */
export const resetStagingAuth = internalAppMutation({
  args: { batchId: v.string() },
  returns: v.object({
    authIdentitiesDeleted: v.number(),
    servicePrincipalsDeleted: v.number(),
    impersonationSessionsDeleted: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const issuer = requireStagingAuthReset(args.batchId);
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
        actor: ctx.actor,
        action: "identity.stagingAuthReset",
        targetType: "systemState",
        targetId: ctx.systemState._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: {
          batchId: args.batchId,
          authIdentitiesDeleted,
          servicePrincipalsDeleted,
          impersonationSessionsDeleted: impersonationSessions.length,
        },
      });
    }
    return {
      authIdentitiesDeleted,
      servicePrincipalsDeleted,
      impersonationSessionsDeleted: impersonationSessions.length,
      // A full batch may have left rows behind.
      done: remaining > 0,
    };
  },
});
