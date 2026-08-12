import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "./errors.js";

type IdentityDatabaseContext = Pick<QueryCtx, "auth" | "db">;

export interface UserActor {
  kind: "user";
  identity: {
    tokenIdentifier: string;
    issuer: string;
    subject: string;
  };
  authIdentity: Doc<"authIdentities">;
  authenticatedUser: Doc<"users">;
  user: Doc<"users">;
  isAdmin: boolean;
  isHost: boolean;
  impersonationSession?: Doc<"impersonationSessions">;
}

export interface ServiceActor {
  kind: "service";
  identity: {
    tokenIdentifier: string;
    issuer: string;
    subject: string;
  };
  servicePrincipal: Doc<"servicePrincipals">;
}

export interface InternalActor {
  kind: "internal";
  label: string;
}

export type ApplicationActor = UserActor | ServiceActor | InternalActor;

async function getIdentity(ctx: IdentityDatabaseContext) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    domainError("AUTHENTICATION_REQUIRED", "Authentication is required.");
  }
  return identity;
}

async function resolveUserRoles(
  ctx: IdentityDatabaseContext,
  userId: Doc<"users">["_id"],
): Promise<{ isAdmin: boolean; isHost: boolean }> {
  const roleLinks = await ctx.db
    .query("userRoles")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .take(50);
  let isAdmin = false;
  let isHost = false;
  for (const roleLink of roleLinks) {
    const role = await ctx.db.get("roles", roleLink.roleId);
    if (role?.admin) {
      isAdmin = true;
    }
    if (role?.normalizedName === "host") {
      isHost = true;
    }
  }
  return { isAdmin, isHost };
}

export async function findActiveImpersonationSession(
  ctx: Pick<QueryCtx, "db">,
  actorUserId: Doc<"users">["_id"],
  now: number,
): Promise<Doc<"impersonationSessions"> | null> {
  const sessions = await ctx.db
    .query("impersonationSessions")
    .withIndex(
      "by_actorUserId_and_revokedAt_and_startedAt",
      (query) =>
        query
          .eq("actorUserId", actorUserId)
          .eq("revokedAt", undefined),
    )
    .order("desc")
    .take(2);
  let activeSession: Doc<"impersonationSessions"> | null = null;
  for (const session of sessions) {
    if (
      session.endsAt <= now
    ) {
      continue;
    }
    if (activeSession !== null) {
      domainError(
        "IDENTITY_CONFLICT",
        "Multiple active impersonation sessions were found.",
      );
    }
    activeSession = session;
  }
  return activeSession;
}

async function requireBaseUserActor(
  ctx: IdentityDatabaseContext,
): Promise<UserActor> {
  const identity = await getIdentity(ctx);
  const authIdentity = await ctx.db
    .query("authIdentities")
    .withIndex("by_tokenIdentifier", (query) =>
      query.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!authIdentity) {
    domainError(
      "IDENTITY_NOT_LINKED",
      "Your authenticated identity is not linked to a BBPC account.",
    );
  }

  const user = await ctx.db.get("users", authIdentity.userId);
  if (!user) {
    domainError("IDENTITY_CONFLICT", "The linked BBPC account is unavailable.");
  }
  if (user.status !== "active") {
    domainError("ACCOUNT_DISABLED", "This BBPC account is disabled.");
  }

  const { isAdmin, isHost } = await resolveUserRoles(
    ctx,
    user._id,
  );

  return {
    kind: "user",
    identity: {
      tokenIdentifier: identity.tokenIdentifier,
      issuer: identity.issuer,
      subject: identity.subject,
    },
    authIdentity,
    authenticatedUser: user,
    user,
    isAdmin,
    isHost,
  };
}

export async function requireUserActor(
  ctx: IdentityDatabaseContext,
): Promise<UserActor> {
  const actor = await requireBaseUserActor(ctx);
  if (!actor.isAdmin) {
    return actor;
  }
  const systemState = await ctx.db
    .query("systemState")
    .withIndex("by_singletonKey", (query) =>
      query.eq("singletonKey", "global"),
    )
    .unique();
  if (
    systemState === null ||
    (systemState.cutoverStage !== "S3" &&
      systemState.cutoverStage !== "S4")
  ) {
    return actor;
  }
  const impersonationSession =
    await findActiveImpersonationSession(
      ctx,
      actor.authenticatedUser._id,
      Date.now(),
    );
  if (impersonationSession === null) {
    return actor;
  }
  const targetUser = await ctx.db.get(
    "users",
    impersonationSession.targetUserId,
  );
  if (targetUser === null) {
    domainError(
      "IDENTITY_CONFLICT",
      "The impersonated BBPC account is unavailable.",
    );
  }
  if (targetUser.status !== "active") {
    domainError(
      "ACCOUNT_DISABLED",
      "The impersonated BBPC account is disabled.",
    );
  }
  const targetRoles = await resolveUserRoles(
    ctx,
    targetUser._id,
  );
  return {
    ...actor,
    user: targetUser,
    isAdmin: targetRoles.isAdmin,
    isHost: targetRoles.isHost,
    impersonationSession,
  };
}

export async function requireAdminActor(
  ctx: IdentityDatabaseContext,
): Promise<UserActor> {
  const actor = await requireBaseUserActor(ctx);
  if (!actor.isAdmin) {
    domainError("FORBIDDEN", "Administrator access is required.");
  }
  return actor;
}

export async function requireServiceActor(
  ctx: IdentityDatabaseContext,
): Promise<ServiceActor> {
  const identity = await getIdentity(ctx);
  const servicePrincipal = await ctx.db
    .query("servicePrincipals")
    .withIndex("by_tokenIdentifier", (query) =>
      query.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!servicePrincipal) {
    domainError("FORBIDDEN", "Pipeline service access is required.");
  }
  if (servicePrincipal.status !== "active") {
    domainError("FORBIDDEN", "This pipeline service is disabled.");
  }

  return {
    kind: "service",
    identity: {
      tokenIdentifier: identity.tokenIdentifier,
      issuer: identity.issuer,
      subject: identity.subject,
    },
    servicePrincipal,
  };
}

export function requireServicePermission(
  actor: ServiceActor,
  permission: string,
): void {
  if (!actor.servicePrincipal.permissions.includes(permission)) {
    domainError(
      "FORBIDDEN",
      "The pipeline service lacks the required permission.",
      { details: { permission } },
    );
  }
}
export function actorLabel(actor: ApplicationActor): string {
  switch (actor.kind) {
    case "user":
      return `user:${actor.authenticatedUser._id}`;
    case "service":
      return `service:${actor.servicePrincipal._id}`;
    case "internal":
      return `internal:${actor.label}`;
  }
}
