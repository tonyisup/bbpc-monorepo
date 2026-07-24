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
  user: Doc<"users">;
  isAdmin: boolean;
  isHost: boolean;
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

export async function requireUserActor(
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

  const roleLinks = await ctx.db
    .query("userRoles")
    .withIndex("by_userId", (query) => query.eq("userId", user._id))
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

  return {
    kind: "user",
    identity: {
      tokenIdentifier: identity.tokenIdentifier,
      issuer: identity.issuer,
      subject: identity.subject,
    },
    authIdentity,
    user,
    isAdmin,
    isHost,
  };
}

export async function requireAdminActor(
  ctx: IdentityDatabaseContext,
): Promise<UserActor> {
  const actor = await requireUserActor(ctx);
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
      return `user:${actor.user._id}`;
    case "service":
      return `service:${actor.servicePrincipal._id}`;
    case "internal":
      return `internal:${actor.label}`;
  }
}
