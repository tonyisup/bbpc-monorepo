import type { UserIdentity } from "convex/server";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { validateUserProfile } from "./adminWriteModel.js";

const MAX_IDENTITY_IMAGE_LENGTH = 2048;

export type IdentityLinkMode =
  | "alreadyLinked"
  | "existingUser"
  | "newUser";

function requireVerifiedProfile(identity: UserIdentity): {
  name: string;
  email: string;
  normalizedEmail: string;
  image?: string;
} {
  if (identity.emailVerified !== true || identity.email === undefined) {
    domainError(
      "IDENTITY_CONFLICT",
      "A verified email address is required to link a BBPC account.",
    );
  }
  const rawEmail = identity.email.trim().normalize("NFKC");
  const fallbackName = rawEmail.slice(
    0,
    Math.max(rawEmail.lastIndexOf("@"), 1),
  );
  const profile = validateUserProfile(
    identity.name ?? fallbackName,
    rawEmail,
  );
  const rawImage = identity.pictureUrl?.trim();
  if (
    rawImage !== undefined &&
    rawImage.length > MAX_IDENTITY_IMAGE_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Identity image URL cannot exceed ${String(MAX_IDENTITY_IMAGE_LENGTH)} characters.`,
    );
  }
  return {
    ...profile,
    ...(rawImage === undefined || rawImage.length === 0
      ? {}
      : { image: rawImage }),
  };
}

async function requireAvailableIdentityKey(
  ctx: MutationCtx,
  identity: UserIdentity,
): Promise<void> {
  const subjectMatches = await ctx.db
    .query("authIdentities")
    .withIndex("by_issuer_and_subject", (index) =>
      index
        .eq("issuer", identity.issuer)
        .eq("subject", identity.subject),
    )
    .take(2);
  if (subjectMatches.length > 0) {
    domainError(
      "IDENTITY_CONFLICT",
      "This authenticated identity conflicts with an existing BBPC link.",
    );
  }
}

async function requireUnlinkedCandidate(
  ctx: MutationCtx,
  normalizedEmail: string,
): Promise<Doc<"users"> | null> {
  const candidates = await ctx.db
    .query("users")
    .withIndex("by_normalizedEmail", (index) =>
      index.eq("normalizedEmail", normalizedEmail),
    )
    .take(2);
  if (candidates.length > 1) {
    domainError(
      "IDENTITY_CONFLICT",
      "This email matches multiple BBPC accounts and requires administrator resolution.",
    );
  }
  const candidate = candidates.at(0);
  if (candidate === undefined) {
    return null;
  }
  if (candidate.status !== "active") {
    domainError(
      "ACCOUNT_DISABLED",
      "The matching BBPC account is disabled.",
    );
  }
  const existingLinks = await ctx.db
    .query("authIdentities")
    .withIndex("by_userId", (index) =>
      index.eq("userId", candidate._id),
    )
    .take(2);
  if (existingLinks.length > 0) {
    domainError(
      "IDENTITY_CONFLICT",
      "The matching BBPC account is already linked to another identity.",
    );
  }
  return candidate;
}

async function insertIdentityLink(
  ctx: MutationCtx,
  identity: UserIdentity,
  userId: Id<"users">,
  verifiedEmail: string,
  now: number,
): Promise<void> {
  await ctx.db.insert("authIdentities", {
    tokenIdentifier: identity.tokenIdentifier,
    issuer: identity.issuer,
    subject: identity.subject,
    userId,
    verifiedEmail,
    linkedAt: now,
    lastSeenAt: now,
  });
}

export async function linkOrCreateIdentity(
  ctx: MutationCtx,
  identity: UserIdentity,
): Promise<{
  userId: Id<"users">;
  linkMode: IdentityLinkMode;
}> {
  const tokenMatches = await ctx.db
    .query("authIdentities")
    .withIndex("by_tokenIdentifier", (index) =>
      index.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .take(2);
  if (tokenMatches.length > 1) {
    domainError(
      "IDENTITY_CONFLICT",
      "This authenticated identity has duplicate BBPC links.",
    );
  }
  const existingLink = tokenMatches.at(0);
  if (existingLink !== undefined) {
    if (
      existingLink.issuer !== identity.issuer ||
      existingLink.subject !== identity.subject
    ) {
      domainError(
        "IDENTITY_CONFLICT",
        "This authenticated identity conflicts with an existing BBPC link.",
      );
    }
    const user = await ctx.db.get("users", existingLink.userId);
    if (user === null) {
      domainError(
        "IDENTITY_CONFLICT",
        "The linked BBPC account is unavailable.",
      );
    }
    if (user.status !== "active") {
      domainError(
        "ACCOUNT_DISABLED",
        "This BBPC account is disabled.",
      );
    }
    await ctx.db.patch("authIdentities", existingLink._id, {
      lastSeenAt: Date.now(),
    });
    return {
      userId: user._id,
      linkMode: "alreadyLinked",
    };
  }

  const profile = requireVerifiedProfile(identity);
  await requireAvailableIdentityKey(ctx, identity);
  const candidate = await requireUnlinkedCandidate(
    ctx,
    profile.normalizedEmail,
  );
  const now = Date.now();
  if (candidate !== null) {
    await ctx.db.patch("users", candidate._id, {
      emailVerifiedAt: candidate.emailVerifiedAt ?? now,
      updatedAt: now,
      ...(candidate.name === undefined ? { name: profile.name } : {}),
      ...(candidate.image === undefined && profile.image !== undefined
        ? { image: profile.image }
        : {}),
    });
    await insertIdentityLink(
      ctx,
      identity,
      candidate._id,
      profile.email,
      now,
    );
    return {
      userId: candidate._id,
      linkMode: "existingUser",
    };
  }

  const userId = await ctx.db.insert("users", {
    name: profile.name,
    email: profile.email,
    normalizedEmail: profile.normalizedEmail,
    emailVerifiedAt: now,
    ...(profile.image === undefined ? {} : { image: profile.image }),
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await insertIdentityLink(
    ctx,
    identity,
    userId,
    profile.email,
    now,
  );
  return {
    userId,
    linkMode: "newUser",
  };
}
