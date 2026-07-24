/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "identity-link-test";
const VERIFIED_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|clerk-user",
  issuer: "https://issuer.example.test",
  subject: "clerk-user",
  email: "Member@Example.test",
  emailVerified: true,
  name: "Clerk Member",
  pictureUrl: "https://images.example.test/member.png",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "identity-link-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "identity-link-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "identity-link-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "identity-link-test",
    approvedBackupId: "identity-link-backup",
    approvedBackupChecksum: "sha256:identity-link",
  });
}

async function seedUser(
  t: TestBackend,
  input: {
    email: string;
    name?: string;
    image?: string;
    status?: "active" | "disabled";
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      ...(input.name === undefined ? {} : { name: input.name }),
      email: input.email,
      normalizedEmail: input.email.trim().toLowerCase(),
      ...(input.image === undefined ? {} : { image: input.image }),
      status: input.status ?? "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

describe("Clerk identity linking", () => {
  test("requires authentication, S3/S4 writes, and the pinned client version", async () => {
    const t = createTestBackend();
    await expectDomainError(
      t.mutation(api.identity.linking.linkOrCreateMe, {
        clientApiVersion: BBPC_API_VERSION,
      }),
      "AUTHENTICATION_REQUIRED",
    );

    await initializeS1(t);
    await expectDomainError(
      t
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "WRITE_DISABLED",
    );

    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S1",
      nextStage: "S2",
      actor: "identity-link-test",
    });
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S2",
      nextStage: "S3",
      actor: "identity-link-test",
      approvedBackupId: "identity-link-backup",
      approvedBackupChecksum: "sha256:identity-link",
    });
    await expectDomainError(
      t
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: "stale-client",
        }),
      "STALE_CLIENT",
    );
  });

  test("links one unclaimed migrated user and fills only missing profile fields", async () => {
    const t = createTestBackend();
    const userId = await seedUser(t, {
      email: "member@example.test",
    });
    await advanceToS3(t);

    await expect(
      t
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
    ).resolves.toEqual({
      id: userId,
      name: "Clerk Member",
      email: "member@example.test",
      image: "https://images.example.test/member.png",
      isAdmin: false,
      isHost: false,
      linkMode: "existingUser",
    });

    const snapshot = await t.run(async (ctx) => {
      const user = await ctx.db.get("users", userId);
      const identities = await ctx.db
        .query("authIdentities")
        .withIndex("by_userId", (index) => index.eq("userId", userId))
        .take(2);
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { user, identities, audits };
    });
    expect(snapshot.user).toMatchObject({
      name: "Clerk Member",
      image: "https://images.example.test/member.png",
    });
    expect(typeof snapshot.user?.emailVerifiedAt).toBe("number");
    expect(snapshot.identities).toHaveLength(1);
    expect(snapshot.identities[0]).toMatchObject({
      tokenIdentifier: VERIFIED_IDENTITY.tokenIdentifier,
      issuer: VERIFIED_IDENTITY.issuer,
      subject: VERIFIED_IDENTITY.subject,
      verifiedEmail: "Member@Example.test",
    });
    expect(
      snapshot.audits.filter((event) => event.action === "identity.linked"),
    ).toHaveLength(1);
    const auditJson = JSON.stringify(snapshot.audits);
    expect(auditJson).not.toContain(VERIFIED_IDENTITY.email);
    expect(auditJson).not.toContain(VERIFIED_IDENTITY.subject);
  });

  test("creates an ordinary canonical user when no migrated candidate exists", async () => {
    const t = createTestBackend();
    await advanceToS3(t);

    const result = await t
      .withIdentity(VERIFIED_IDENTITY)
      .mutation(api.identity.linking.linkOrCreateMe, {
        clientApiVersion: BBPC_API_VERSION,
      });
    expect(result).toMatchObject({
      name: "Clerk Member",
      email: "Member@Example.test",
      image: "https://images.example.test/member.png",
      isAdmin: false,
      linkMode: "newUser",
    });

    await expect(
      t.withIdentity(VERIFIED_IDENTITY).query(api.identity.profile.me, {}),
    ).resolves.toMatchObject({
      id: result.id,
      isAdmin: false,
    });
  });

  test("is idempotent for an already-linked identity", async () => {
    const t = createTestBackend();
    await advanceToS3(t);

    const first = await t
      .withIdentity(VERIFIED_IDENTITY)
      .mutation(api.identity.linking.linkOrCreateMe, {
        clientApiVersion: BBPC_API_VERSION,
      });
    const second = await t
      .withIdentity(VERIFIED_IDENTITY)
      .mutation(api.identity.linking.linkOrCreateMe, {
        clientApiVersion: BBPC_API_VERSION,
      });
    expect(second).toMatchObject({
      id: first.id,
      linkMode: "alreadyLinked",
    });

    const counts = await t.run(async (ctx) => {
      const identities = await ctx.db
        .query("authIdentities")
        .withIndex("by_tokenIdentifier", (index) =>
          index.eq("tokenIdentifier", VERIFIED_IDENTITY.tokenIdentifier),
        )
        .take(2);
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return {
        identityCount: identities.length,
        linkedAuditCount: audits.filter(
          (event) => event.action === "identity.linked",
        ).length,
      };
    });
    expect(counts).toEqual({
      identityCount: 1,
      linkedAuditCount: 1,
    });
  });

  test("preserves administrator status when linking an existing account", async () => {
    const t = createTestBackend();
    const userId = await seedUser(t, {
      email: "member@example.test",
      name: "Migrated Admin",
      image: "https://images.example.test/migrated.png",
    });
    await t.run(async (ctx) => {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: 1,
      });
    });
    await advanceToS3(t);

    await expect(
      t
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
    ).resolves.toMatchObject({
      id: userId,
      name: "Migrated Admin",
      image: "https://images.example.test/migrated.png",
      isAdmin: true,
      linkMode: "existingUser",
    });
  });

  test("rejects unverified identities without crossing the first-write boundary", async () => {
    const t = createTestBackend();
    await advanceToS3(t);
    await expectDomainError(
      t
        .withIdentity({
          ...VERIFIED_IDENTITY,
          emailVerified: false,
        })
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "IDENTITY_CONFLICT",
    );

    const state = await t.run(async (ctx) => {
      return await ctx.db
        .query("systemState")
        .withIndex("by_singletonKey", (index) =>
          index.eq("singletonKey", "global"),
        )
        .unique();
    });
    expect(state?.firstApplicationWriteAt).toBeUndefined();
  });

  test("fails closed for duplicate, disabled, or already-claimed candidates", async () => {
    const duplicate = createTestBackend();
    await seedUser(duplicate, { email: "member@example.test" });
    await seedUser(duplicate, { email: "member@example.test" });
    await advanceToS3(duplicate);
    await expectDomainError(
      duplicate
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "IDENTITY_CONFLICT",
    );

    const disabled = createTestBackend();
    await seedUser(disabled, {
      email: "member@example.test",
      status: "disabled",
    });
    await advanceToS3(disabled);
    await expectDomainError(
      disabled
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "ACCOUNT_DISABLED",
    );

    const claimed = createTestBackend();
    const claimedUserId = await seedUser(claimed, {
      email: "member@example.test",
    });
    await claimed.run(async (ctx) => {
      await ctx.db.insert("authIdentities", {
        tokenIdentifier: "https://issuer.example.test|other-clerk-user",
        issuer: "https://issuer.example.test",
        subject: "other-clerk-user",
        userId: claimedUserId,
        linkedAt: 1,
        lastSeenAt: 1,
      });
    });
    await advanceToS3(claimed);
    await expectDomainError(
      claimed
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "IDENTITY_CONFLICT",
    );
  });

  test("rejects a reused issuer/subject under a conflicting token identifier", async () => {
    const t = createTestBackend();
    const userId = await seedUser(t, {
      email: "other@example.test",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("authIdentities", {
        tokenIdentifier: "unexpected-token-identifier-format",
        issuer: VERIFIED_IDENTITY.issuer,
        subject: VERIFIED_IDENTITY.subject,
        userId,
        linkedAt: 1,
        lastSeenAt: 1,
      });
    });
    await advanceToS3(t);

    await expectDomainError(
      t
        .withIdentity(VERIFIED_IDENTITY)
        .mutation(api.identity.linking.linkOrCreateMe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "IDENTITY_CONFLICT",
    );
  });
});
