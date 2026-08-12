import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeEmail } from "../lib/normalize.js";

const MAX_IDENTITY_KEY_LENGTH = 2000;
const MAX_PRINCIPAL_NAME_LENGTH = 100;
const MAX_SERVICE_PERMISSIONS = 50;
const MAX_SERVICE_PERMISSION_LENGTH = 100;

function requireIdentityKey(value: string, label: string): string {
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > MAX_IDENTITY_KEY_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(MAX_IDENTITY_KEY_LENGTH)} characters.`,
    );
  }
  return normalized;
}

function requirePrincipalName(value: string): string {
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > MAX_PRINCIPAL_NAME_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Service-principal name must contain 1 through ${String(MAX_PRINCIPAL_NAME_LENGTH)} characters.`,
    );
  }
  return normalized;
}

function requirePermissions(values: string[]): string[] {
  if (values.length > MAX_SERVICE_PERMISSIONS) {
    domainError(
      "VALIDATION_FAILED",
      `A service principal can have at most ${String(MAX_SERVICE_PERMISSIONS)} permissions.`,
    );
  }
  const permissions = values.map((value) =>
    value.trim().normalize("NFKC").toLowerCase(),
  );
  if (
    permissions.some(
      (permission) =>
        permission.length < 1 ||
        permission.length > MAX_SERVICE_PERMISSION_LENGTH ||
        !/^[a-z0-9]+(?::[a-z0-9-]+)+$/u.test(permission),
    )
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Service permissions must use bounded lowercase capability names.",
    );
  }
  if (new Set(permissions).size !== permissions.length) {
    domainError(
      "VALIDATION_FAILED",
      "Service permissions cannot contain duplicates.",
    );
  }
  return permissions.sort((left, right) =>
    left.localeCompare(right),
  );
}

async function findUserByLegacyId(
  ctx: MutationCtx,
  legacyId: string,
): Promise<Doc<"users">> {
  const users = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (index) =>
      index.eq("legacyId", legacyId),
    )
    .take(2);
  if (users.length !== 1) {
    domainError(
      "IDENTITY_CONFLICT",
      "The smoke identity must resolve to exactly one migrated BBPC user.",
    );
  }
  const user = users.at(0);
  if (user === undefined) {
    domainError(
      "IDENTITY_CONFLICT",
      "The smoke identity user is unavailable.",
    );
  }
  if (user.status !== "active") {
    domainError(
      "ACCOUNT_DISABLED",
      "The smoke identity user is disabled.",
    );
  }
  return user;
}

async function requireUserLinkAvailable(
  ctx: MutationCtx,
  input: {
    tokenIdentifier: string;
    issuer: string;
    subject: string;
    userId: Id<"users">;
  },
): Promise<Id<"authIdentities"> | null> {
  const tokenMatches = await ctx.db
    .query("authIdentities")
    .withIndex("by_tokenIdentifier", (index) =>
      index.eq("tokenIdentifier", input.tokenIdentifier),
    )
    .take(2);
  if (tokenMatches.length > 1) {
    domainError(
      "IDENTITY_CONFLICT",
      "The smoke identity has duplicate token links.",
    );
  }
  const tokenMatch = tokenMatches.at(0);
  if (tokenMatch !== undefined) {
    if (
      tokenMatch.issuer !== input.issuer ||
      tokenMatch.subject !== input.subject ||
      tokenMatch.userId !== input.userId
    ) {
      domainError(
        "IDENTITY_CONFLICT",
        "The smoke identity conflicts with an existing link.",
      );
    }
    return tokenMatch._id;
  }

  const subjectMatches = await ctx.db
    .query("authIdentities")
    .withIndex("by_issuer_and_subject", (index) =>
      index
        .eq("issuer", input.issuer)
        .eq("subject", input.subject),
    )
    .take(1);
  const userMatches = await ctx.db
    .query("authIdentities")
    .withIndex("by_userId", (index) =>
      index.eq("userId", input.userId),
    )
    .take(1);
  if (subjectMatches.length > 0 || userMatches.length > 0) {
    domainError(
      "IDENTITY_CONFLICT",
      "The smoke identity or BBPC user is already linked.",
    );
  }
  return null;
}

export async function preprovisionUserIdentity(
  ctx: MutationCtx,
  input: {
    userLegacyId: string;
    tokenIdentifier: string;
    issuer: string;
    subject: string;
    verifiedEmail: string;
  },
): Promise<{
  authIdentityId: Id<"authIdentities">;
  userId: Id<"users">;
  created: boolean;
}> {
  const user = await findUserByLegacyId(
    ctx,
    requireIdentityKey(input.userLegacyId, "User legacy ID"),
  );
  const verifiedEmail = input.verifiedEmail
    .trim()
    .normalize("NFKC");
  if (
    user.normalizedEmail === undefined ||
    normalizeEmail(verifiedEmail) !== user.normalizedEmail
  ) {
    domainError(
      "IDENTITY_CONFLICT",
      "The verified smoke identity email does not match the migrated BBPC user.",
    );
  }
  const identity = {
    tokenIdentifier: requireIdentityKey(
      input.tokenIdentifier,
      "Token identifier",
    ),
    issuer: requireIdentityKey(input.issuer, "Issuer"),
    subject: requireIdentityKey(input.subject, "Subject"),
  };
  const existingId = await requireUserLinkAvailable(ctx, {
    ...identity,
    userId: user._id,
  });
  if (existingId !== null) {
    return {
      authIdentityId: existingId,
      userId: user._id,
      created: false,
    };
  }

  const now = Date.now();
  const authIdentityId = await ctx.db.insert(
    "authIdentities",
    {
      ...identity,
      userId: user._id,
      verifiedEmail,
      linkedAt: now,
      lastSeenAt: now,
    },
  );
  return {
    authIdentityId,
    userId: user._id,
    created: true,
  };
}

async function requireServiceLinkAvailable(
  ctx: MutationCtx,
  input: {
    tokenIdentifier: string;
    issuer: string;
    subject: string;
    cutoverRunId: string;
    name: string;
    permissions: string[];
  },
): Promise<Id<"servicePrincipals"> | null> {
  const tokenMatches = await ctx.db
    .query("servicePrincipals")
    .withIndex("by_tokenIdentifier", (index) =>
      index.eq("tokenIdentifier", input.tokenIdentifier),
    )
    .take(2);
  if (tokenMatches.length > 1) {
    domainError(
      "IDENTITY_CONFLICT",
      "The pipeline identity has duplicate service-principal links.",
    );
  }
  const tokenMatch = tokenMatches.at(0);
  if (tokenMatch !== undefined) {
    if (
      tokenMatch.issuer !== input.issuer ||
      tokenMatch.subject !== input.subject ||
      tokenMatch.cutoverRunId !== input.cutoverRunId ||
      tokenMatch.name !== input.name ||
      tokenMatch.status !== "active" ||
      tokenMatch.permissions.length !== input.permissions.length ||
      !tokenMatch.permissions.every(
        (permission, index) =>
          permission === input.permissions[index],
      )
    ) {
      domainError(
        "IDENTITY_CONFLICT",
        "The pipeline identity conflicts with an existing service principal.",
      );
    }
    return tokenMatch._id;
  }

  const subjectMatches = await ctx.db
    .query("servicePrincipals")
    .withIndex("by_issuer_and_subject", (index) =>
      index
        .eq("issuer", input.issuer)
        .eq("subject", input.subject),
    )
    .take(1);
  if (subjectMatches.length > 0) {
    domainError(
      "IDENTITY_CONFLICT",
      "The pipeline issuer and subject are already linked.",
    );
  }
  return null;
}

export async function preprovisionServicePrincipal(
  ctx: MutationCtx,
  input: {
    tokenIdentifier: string;
    issuer: string;
    subject: string;
    name: string;
    permissions: string[];
    cutoverRunId: string;
  },
): Promise<{
  servicePrincipalId: Id<"servicePrincipals">;
  created: boolean;
}> {
  const principal = {
    tokenIdentifier: requireIdentityKey(
      input.tokenIdentifier,
      "Token identifier",
    ),
    issuer: requireIdentityKey(input.issuer, "Issuer"),
    subject: requireIdentityKey(input.subject, "Subject"),
    name: requirePrincipalName(input.name),
    permissions: requirePermissions(input.permissions),
    cutoverRunId: input.cutoverRunId,
  };
  const existingId = await requireServiceLinkAvailable(
    ctx,
    principal,
  );
  if (existingId !== null) {
    return {
      servicePrincipalId: existingId,
      created: false,
    };
  }

  const now = Date.now();
  const servicePrincipalId = await ctx.db.insert(
    "servicePrincipals",
    {
      ...principal,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  );
  return {
    servicePrincipalId,
    created: true,
  };
}
