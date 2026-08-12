/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "identity-impersonation-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|admin",
  issuer: "https://issuer.example.test",
  subject: "admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|member",
  issuer: "https://issuer.example.test",
  subject: "member",
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

async function seedLinkedUser(
  t: TestBackend,
  input: {
    identity: typeof ADMIN_IDENTITY;
    name: string;
    admin?: boolean;
    status?: "active" | "disabled";
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: input.name,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("authIdentities", {
      ...input.identity,
      userId,
      linkedAt: now,
      lastSeenAt: now,
    });
    if (input.admin === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator",
        admin: true,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
      });
    }
    return userId;
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "identity-impersonation-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "identity-impersonation-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "identity-impersonation-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "identity-impersonation-test",
    approvedBackupId: "impersonation-backup",
    approvedBackupChecksum: "sha256:impersonation",
  });
}

describe("administrator impersonation", () => {
  test("scopes owner calls to the target and preserves the audited administrator actor", async () => {
    const t = createTestBackend();
    const adminUserId = await seedLinkedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin User",
      admin: true,
    });
    const memberUserId = await seedLinkedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member User",
    });
    await advanceToS3(t);

    const started = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.identity.impersonation.start, {
        clientApiVersion: BBPC_API_VERSION,
        targetUserId: memberUserId,
        reason: "  Investigate member support case  ",
        durationMinutes: 15,
      });
    expect(started).toMatchObject({
      targetUserId: memberUserId,
      targetName: "Member User",
      reason: "Investigate member support case",
    });

    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.impersonation.current, {}),
    ).resolves.toEqual(started);
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
    ).resolves.toMatchObject({
      id: memberUserId,
      isAdmin: false,
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.administratorMe, {}),
    ).resolves.toMatchObject({
      id: adminUserId,
      isAdmin: true,
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          clientApiVersion: BBPC_API_VERSION,
          targetUserId: memberUserId,
          reason: "Investigate another member support case",
          durationMinutes: 10,
        }),
      "CONFLICT",
    );

    await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.identity.profile.updateMyName, {
        clientApiVersion: BBPC_API_VERSION,
        name: "Member Updated",
      });
    const snapshot = await t.run(async (ctx) => {
      const admin = await ctx.db.get("users", adminUserId);
      const member = await ctx.db.get("users", memberUserId);
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(50);
      return { admin, member, audits };
    });
    expect(snapshot.admin?.name).toBe("Admin User");
    expect(snapshot.member?.name).toBe("Member Updated");
    expect(
      snapshot.audits.find(
        (event) =>
          event.action ===
          "identity.profile.nameUpdated",
      ),
    ).toMatchObject({
      actorUserId: adminUserId,
      impersonationSessionId: started.id,
      targetId: memberUserId,
    });
    expect(
      snapshot.audits.find(
        (event) =>
          event.action ===
          "identity.impersonation.started",
      ),
    ).toMatchObject({
      actorUserId: adminUserId,
      impersonationSessionId: started.id,
    });

    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.revoke, {
          clientApiVersion: BBPC_API_VERSION,
          sessionId: started.id,
        }),
    ).resolves.toMatchObject({ revoked: true });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.impersonation.current, {}),
    ).resolves.toBeNull();
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
    ).resolves.toMatchObject({
      id: adminUserId,
      isAdmin: true,
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.revoke, {
          clientApiVersion: BBPC_API_VERSION,
          sessionId: started.id,
        }),
    ).resolves.toMatchObject({ revoked: false });
    await t.run(async (ctx) => {
      await ctx.db.delete(started.id);
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.revoke, {
          clientApiVersion: BBPC_API_VERSION,
          sessionId: started.id,
        }),
      "NOT_FOUND",
    );
  });

  test("requires an administrator, S3 writes, valid bounds, and an active target", async () => {
    const t = createTestBackend();
    const adminUserId = await seedLinkedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin User",
      admin: true,
    });
    const memberUserId = await seedLinkedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member User",
    });
    const disabledUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Disabled User",
        status: "disabled",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await initializeS1(t);

    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          clientApiVersion: BBPC_API_VERSION,
          targetUserId: memberUserId,
          reason: "Investigate member support case",
          durationMinutes: 15,
        }),
      "WRITE_DISABLED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.identity.impersonation.current, {}),
      "FORBIDDEN",
    );
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.impersonation.current, {}),
    ).resolves.toBeNull();

    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S1",
      nextStage: "S2",
      actor: "identity-impersonation-test",
    });
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S2",
      nextStage: "S3",
      actor: "identity-impersonation-test",
      approvedBackupId: "impersonation-backup",
      approvedBackupChecksum: "sha256:impersonation",
    });
    const baseArgs = {
      clientApiVersion: BBPC_API_VERSION,
      targetUserId: memberUserId,
      reason: "Investigate member support case",
      durationMinutes: 15,
    };
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .mutation(api.identity.impersonation.start, baseArgs),
      "FORBIDDEN",
    );
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          ...baseArgs,
          targetUserId: adminUserId,
        }),
      "VALIDATION_FAILED",
    );
    const deletedUserId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "Deleted User",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          ...baseArgs,
          targetUserId: deletedUserId,
        }),
      "NOT_FOUND",
    );
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          ...baseArgs,
          targetUserId: disabledUserId,
        }),
      "ACCOUNT_DISABLED",
    );
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          ...baseArgs,
          reason: "short",
        }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.identity.impersonation.start, {
          ...baseArgs,
          durationMinutes: 1.5,
        }),
      "VALIDATION_FAILED",
    );
  });

  test("ignores sessions outside S3/S4 and expires them with value-free audit evidence", async () => {
    const t = createTestBackend();
    const adminUserId = await seedLinkedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin User",
      admin: true,
    });
    const memberUserId = await seedLinkedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member User",
    });
    await initializeS1(t);
    const expiredSessionId = await t.run(async (ctx) => {
      return await ctx.db.insert("impersonationSessions", {
        actorUserId: adminUserId,
        targetUserId: memberUserId,
        reason: "Expired support investigation",
        startedAt: 1,
        endsAt: 2,
      });
    });

    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
    ).resolves.toMatchObject({ id: adminUserId });
    await expect(
      t.mutation(
        internal.identity.impersonation.expire,
        { sessionId: expiredSessionId },
      ),
    ).resolves.toEqual({ expired: true });
    await expect(
      t.mutation(
        internal.identity.impersonation.expire,
        { sessionId: expiredSessionId },
      ),
    ).resolves.toEqual({ expired: false });
    const snapshot = await t.run(async (ctx) => {
      const session = await ctx.db.get(
        "impersonationSessions",
        expiredSessionId,
      );
      const audits = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { session, audits };
    });
    expect(snapshot.session?.revokedAt).toBe(2);
    expect(
      snapshot.audits.find(
        (event) =>
          event.action ===
          "identity.impersonation.expired",
      ),
    ).toMatchObject({
      actorType: "internal",
      impersonationSessionId: expiredSessionId,
    });
    expect(JSON.stringify(snapshot.audits)).not.toContain(
      "Expired support investigation",
    );

    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S1",
      nextStage: "S2",
      actor: "identity-impersonation-test",
    });
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S2",
      nextStage: "S3",
      actor: "identity-impersonation-test",
      approvedBackupId: "impersonation-backup",
      approvedBackupChecksum: "sha256:impersonation",
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("impersonationSessions", {
        actorUserId: adminUserId,
        targetUserId: memberUserId,
        reason: "Unrevoked expired investigation",
        startedAt: now - 10_000,
        endsAt: now - 1,
      });
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
    ).resolves.toMatchObject({ id: adminUserId });

    const { activeSessionId, duplicateSessionId } =
      await t.run(async (ctx) => {
        const now = Date.now();
        const activeId = await ctx.db.insert(
          "impersonationSessions",
          {
            actorUserId: adminUserId,
            targetUserId: memberUserId,
            reason: "Active support investigation",
            startedAt: now,
            endsAt: now + 60_000,
          },
        );
        const duplicateId = await ctx.db.insert(
          "impersonationSessions",
          {
            actorUserId: adminUserId,
            targetUserId: memberUserId,
            reason: "Duplicate support investigation",
            startedAt: now + 1,
            endsAt: now + 60_000,
          },
        );
        return {
          activeSessionId: activeId,
          duplicateSessionId: duplicateId,
        };
      });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
      "IDENTITY_CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete(duplicateSessionId);
      await ctx.db.patch("users", memberUserId, {
        status: "disabled",
      });
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.impersonation.current, {}),
      "ACCOUNT_DISABLED",
    );
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
      "ACCOUNT_DISABLED",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete(memberUserId);
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.identity.profile.me, {}),
      "IDENTITY_CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete(activeSessionId);
    });
  });
});
