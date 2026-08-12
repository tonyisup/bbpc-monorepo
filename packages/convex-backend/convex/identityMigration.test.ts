/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";
import {
  IDENTITY_OPERATIONS,
  IDENTITY_RECONCILIATION_OPERATIONS,
  SOURCE_SCHEMA_FINGERPRINT,
} from "./migration/constants.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "identity-migration-test-001";

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

async function initializeAtS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "identity-migration-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "identity-migration-test",
  });
}

async function startRun(
  t: TestBackend,
  counts: {
    users: number;
    roles: number;
    userRoles: number;
  },
) {
  return await t.mutation(
    internal.migration.identity.startIdentityRun,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_OPERATIONS.start,
      sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
      expectedUsers: counts.users,
      expectedRoles: counts.roles,
      expectedUserRoles: counts.userRoles,
    },
  );
}

async function reconcileAll(t: TestBackend): Promise<void> {
  await t.mutation(
    internal.migration.identityReconciliation.reconcileUsersBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_RECONCILIATION_OPERATIONS.users,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.identityReconciliation.reconcileRolesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_RECONCILIATION_OPERATIONS.roles,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.identityReconciliation
      .reconcileUserRolesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
      batchSize: 100,
    },
  );
}

async function transformAndFinishIdentity(
  t: TestBackend,
): Promise<void> {
  await t.mutation(
    internal.migration.identity.transformRolesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_OPERATIONS.roles,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.identity.transformUsersBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_OPERATIONS.users,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.identity.transformUserRolesBatch,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_OPERATIONS.userRoles,
      batchSize: 100,
    },
  );
  await t.mutation(
    internal.migration.identity.finishIdentityRun,
    {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: IDENTITY_OPERATIONS.finish,
    },
  );
}

describe("identity migration slice", () => {
  test("transforms synthetic users, roles, and links in dependency order", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        name: "  HＯST  ",
        description: "Synthetic host",
        admin: false,
        sourceRowHash: "sha256:role-1",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 2,
        name: "Administrator",
        description: "Synthetic administrator",
        admin: true,
        sourceRowHash: "sha256:role-2",
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "legacy-user-001",
        name: "Synthetic Person",
        email: "  PERSON@EXAMPLE.TEST  ",
        emailVerifiedAt: 1_700_000_000_000,
        image: "https://example.test/avatar.png",
        sourceRowHash: "sha256:user-1",
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "legacy-user-002",
        sourceRowHash: "sha256:user-2",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000001",
        userLegacyId: "legacy-user-001",
        roleLegacyId: 2,
        sourceRowHash: "sha256:user-role-1",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000002",
        userLegacyId: "legacy-user-002",
        roleLegacyId: 1,
        sourceRowHash: "sha256:user-role-2",
      });
    });

    await expect(
      startRun(t, { users: 2, roles: 2, userRoles: 2 }),
    ).resolves.toMatchObject({
      runId: CUTOVER_RUN_ID,
      status: "running",
      created: true,
    });

    await expect(
      t.mutation(internal.migration.identity.transformRolesBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 1,
      }),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
    });
    await expect(
      t.mutation(internal.migration.identity.transformRolesBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 1,
      }),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
      insertedCount: 2,
    });
    await expect(
      t.mutation(internal.migration.identity.transformUsersBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 1,
      }),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
      insertedCount: 1,
    });
    await expect(
      t.mutation(internal.migration.identity.transformUsersBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 1,
      }),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
      insertedCount: 2,
    });
    await expect(
      t.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "running",
      processedCount: 1,
      insertedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 1,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      processedCount: 2,
      insertedCount: 2,
    });
    await expect(
      t.mutation(internal.migration.identity.finishIdentityRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.finish,
      }),
    ).resolves.toEqual({
      runId: CUTOVER_RUN_ID,
      status: "transformed",
      users: 2,
      roles: 2,
      userRoles: 2,
    });

    const snapshot = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", "legacy-user-001"),
        )
        .unique();
      if (!user) {
        throw new Error("Synthetic migrated user is missing");
      }
      const hostRole = await ctx.db
        .query("roles")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      const adminRole = await ctx.db
        .query("roles")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 2),
        )
        .unique();
      const links = await ctx.db
        .query("userRoles")
        .withIndex("by_userId", (query) =>
          query.eq("userId", user._id),
        )
        .take(10);
      const authIdentities = await ctx.db
        .query("authIdentities")
        .withIndex("by_userId", (query) =>
          query.eq("userId", user._id),
        )
        .take(10);
      return {
        user,
        hostRole,
        adminRole,
        links,
        authIdentities,
      };
    });

    expect(snapshot.user).toMatchObject({
      legacyId: "legacy-user-001",
      email: "  PERSON@EXAMPLE.TEST  ",
      normalizedEmail: "person@example.test",
      emailVerifiedAt: 1_700_000_000_000,
      status: "active",
    });
    expect(snapshot.user).not.toHaveProperty("impersonatedUserId");
    expect(snapshot.hostRole).toMatchObject({
      normalizedName: "host",
      permissions: [],
    });
    expect(snapshot.adminRole).toMatchObject({
      normalizedName: "administrator",
      permissions: ["admin"],
    });
    expect(snapshot.links).toHaveLength(1);
    expect(snapshot.links[0]?.legacyId).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(snapshot.authIdentities).toEqual([]);

    await expect(
      t.mutation(internal.migration.identity.transformRolesBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 1,
      }),
    ).rejects.toBeInstanceOf(ConvexError);
  });

  test("denies migration writes outside S1/S2 and rejects fingerprint drift", async () => {
    const outsideWindow = createTestBackend();
    await outsideWindow.mutation(
      internal.system.cutover.initialize,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        apiVersion: BBPC_API_VERSION,
        actor: "identity-migration-test",
      },
    );
    await expectDomainError(
      startRun(outsideWindow, {
        users: 0,
        roles: 0,
        userRoles: 0,
      }),
      "WRITE_DISABLED",
    );

    const drifted = createTestBackend();
    await initializeAtS1(drifted);
    await expectDomainError(
      drifted.mutation(
        internal.migration.identity.startIdentityRun,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.start,
          sourceSchemaFingerprint: "sha256:unexpected",
          expectedUsers: 0,
          expectedRoles: 0,
          expectedUserRoles: 0,
        },
      ),
      "CONFLICT",
    );
  });

  test("rolls back a batch whose relationship parent is missing", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000002",
        userLegacyId: "missing-user",
        roleLegacyId: 99,
        sourceRowHash: "sha256:missing-link",
      });
    });
    await startRun(t, { users: 0, roles: 0, userRoles: 1 });
    await t.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );

    await expectDomainError(
      t.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    const persisted = await t.run(async (ctx) => {
      const links = await ctx.db
        .query("userRoles")
        .withIndex("by_legacyId")
        .take(10);
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq("operation", IDENTITY_OPERATIONS.userRoles),
        )
        .unique();
      return { links, checkpoint };
    });
    expect(persisted).toEqual({ links: [], checkpoint: null });
  });

  test("reuses matching canonical documents and completed checkpoints", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        legacyId: "legacy-user-reused",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const roleId = await ctx.db.insert("roles", {
        legacyId: 7,
        name: "Member",
        normalizedName: "member",
        description: "Synthetic member",
        admin: false,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        legacyId: "00000000-0000-0000-0000-000000000007",
        userId,
        roleId,
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "legacy-user-reused",
        sourceRowHash: "sha256:user-reused",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 7,
        name: "Member",
        description: "Synthetic member",
        admin: false,
        sourceRowHash: "sha256:role-reused",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000007",
        userLegacyId: "legacy-user-reused",
        roleLegacyId: 7,
        sourceRowHash: "sha256:link-reused",
      });
    });

    await startRun(t, { users: 1, roles: 1, userRoles: 1 });
    await expect(
      startRun(t, { users: 1, roles: 1, userRoles: 1 }),
    ).resolves.toMatchObject({ created: false, status: "running" });
    await expectDomainError(
      startRun(t, { users: 2, roles: 1, userRoles: 1 }),
      "CONFLICT",
    );

    const roleResult = await t.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    const userResult = await t.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    const linkResult = await t.mutation(
      internal.migration.identity.transformUserRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.userRoles,
        batchSize: 10,
      },
    );
    expect([roleResult, userResult, linkResult]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reusedCount: 1,
          insertedCount: 0,
          status: "completed",
        }),
      ]),
    );

    await expect(
      t.mutation(internal.migration.identity.transformRolesBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      }),
    ).resolves.toEqual(roleResult);
    await expect(
      t.mutation(internal.migration.identity.transformUsersBatch, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      }),
    ).resolves.toEqual(userResult);
    await expect(
      t.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
    ).resolves.toEqual(linkResult);

    await t.mutation(
      internal.migration.identity.finishIdentityRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.finish,
      },
    );
    await expect(
      startRun(t, { users: 1, roles: 1, userRoles: 1 }),
    ).resolves.toMatchObject({
      created: false,
      status: "transformed",
    });
  });

  test("validates operation IDs, counts, batch sizes, and dependency gates", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await expectDomainError(
      t.mutation(
        internal.migration.identity.startIdentityRun,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: "identity.wrong",
          sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
          expectedUsers: 0,
          expectedRoles: 0,
          expectedUserRoles: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      startRun(t, { users: -1, roles: 0, userRoles: 0 }),
      "VALIDATION_FAILED",
    );
    await startRun(t, { users: 0, roles: 0, userRoles: 0 });
    await expectDomainError(
      t.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(internal.migration.identity.finishIdentityRun, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.finish,
      }),
      "CONFLICT",
    );
  });

  test("rejects invalid roles and normalized-key collisions", async () => {
    const blank = createTestBackend();
    await initializeAtS1(blank);
    await blank.run(async (ctx) => {
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        name: "   ",
        description: "Blank role",
        admin: false,
        sourceRowHash: "sha256:blank",
      });
    });
    await startRun(blank, { users: 0, roles: 1, userRoles: 0 });
    await expectDomainError(
      blank.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const outOfRange = createTestBackend();
    await initializeAtS1(outOfRange);
    await outOfRange.run(async (ctx) => {
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 256,
        name: "Invalid",
        description: "Out of range",
        admin: false,
        sourceRowHash: "sha256:range",
      });
    });
    await startRun(outOfRange, {
      users: 0,
      roles: 1,
      userRoles: 0,
    });
    await expectDomainError(
      outOfRange.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );

    const collision = createTestBackend();
    await initializeAtS1(collision);
    await collision.run(async (ctx) => {
      await ctx.db.insert("roles", {
        legacyId: 1,
        name: "Member",
        normalizedName: "member",
        description: "Existing",
        admin: false,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 2,
        name: "ＭＥＭＢＥＲ",
        description: "Colliding",
        admin: false,
        sourceRowHash: "sha256:collision",
      });
    });
    await startRun(collision, {
      users: 0,
      roles: 1,
      userRoles: 0,
    });
    await expectDomainError(
      collision.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects canonical user and role conflicts", async () => {
    const roleConflict = createTestBackend();
    await initializeAtS1(roleConflict);
    await roleConflict.run(async (ctx) => {
      await ctx.db.insert("roles", {
        legacyId: 3,
        name: "Member",
        normalizedName: "member",
        description: "Existing description",
        admin: false,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 3,
        name: "Member",
        description: "Different description",
        admin: false,
        sourceRowHash: "sha256:role-conflict",
      });
    });
    await startRun(roleConflict, {
      users: 0,
      roles: 1,
      userRoles: 0,
    });
    await expectDomainError(
      roleConflict.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const emailCollision = createTestBackend();
    await initializeAtS1(emailCollision);
    await emailCollision.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: "existing-user",
        email: "person@example.test",
        normalizedEmail: "person@example.test",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "new-user",
        email: "PERSON@EXAMPLE.TEST",
        sourceRowHash: "sha256:email-collision",
      });
    });
    await startRun(emailCollision, {
      users: 1,
      roles: 0,
      userRoles: 0,
    });
    await expectDomainError(
      emailCollision.mutation(
        internal.migration.identity.transformUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const userConflict = createTestBackend();
    await initializeAtS1(userConflict);
    await userConflict.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: "same-user",
        name: "Existing name",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "same-user",
        name: "Different name",
        sourceRowHash: "sha256:user-conflict",
      });
    });
    await startRun(userConflict, {
      users: 1,
      roles: 0,
      userRoles: 0,
    });
    await expectDomainError(
      userConflict.mutation(
        internal.migration.identity.transformUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("detects missing runs, corrupt cursors, and reconciliation mismatches", async () => {
    const missingRun = createTestBackend();
    await initializeAtS1(missingRun);
    await expectDomainError(
      missingRun.mutation(
        internal.migration.identity.transformUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const corruptCursor = createTestBackend();
    await initializeAtS1(corruptCursor);
    await corruptCursor.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "running",
        startedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("migrationDomainRuns", {
        runId: CUTOVER_RUN_ID,
        domain: "identity",
        status: "running",
        expectedCounts: { users: 0, roles: 0, userRoles: 0 },
        startedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("migrationCheckpoints", {
        runId: CUTOVER_RUN_ID,
        operation: IDENTITY_OPERATIONS.roles,
        status: "running",
        lastLegacyKey: "not-a-number",
        processedCount: 0,
        insertedCount: 0,
        reusedCount: 0,
        updatedAt: now,
      });
    });
    await expectDomainError(
      corruptCursor.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "INTERNAL_ERROR",
    );

    const countMismatch = createTestBackend();
    await initializeAtS1(countMismatch);
    await startRun(countMismatch, {
      users: 1,
      roles: 0,
      userRoles: 0,
    });
    await countMismatch.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await countMismatch.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    await countMismatch.mutation(
      internal.migration.identity.transformUserRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.userRoles,
        batchSize: 10,
      },
    );
    await expectDomainError(
      countMismatch.mutation(
        internal.migration.identity.finishIdentityRun,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
  });

  test("detects corrupt runs and every canonical relationship conflict", async () => {
    const corruptRun = createTestBackend();
    await initializeAtS1(corruptRun);
    await corruptRun.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: "sha256:corrupt",
        status: "running",
        startedAt: now,
        updatedAt: now,
      });
    });
    await expectDomainError(
      startRun(corruptRun, {
        users: 0,
        roles: 0,
        userRoles: 0,
      }),
      "CONFLICT",
    );
    await expectDomainError(
      corruptRun.mutation(
        internal.migration.identity.transformUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const stoppedRun = createTestBackend();
    await initializeAtS1(stoppedRun);
    await stoppedRun.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "transformed",
        startedAt: now,
        updatedAt: now,
      });
    });
    await expectDomainError(
      stoppedRun.mutation(
        internal.migration.identity.transformUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const missingDomain = createTestBackend();
    await initializeAtS1(missingDomain);
    await missingDomain.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("migrationRuns", {
        runId: CUTOVER_RUN_ID,
        sourceSchemaFingerprint: SOURCE_SCHEMA_FINGERPRINT,
        status: "running",
        startedAt: now,
        updatedAt: now,
      });
    });
    await expectDomainError(
      missingDomain.mutation(
        internal.migration.identity.transformUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expect(
      startRun(missingDomain, {
        users: 0,
        roles: 0,
        userRoles: 0,
      }),
    ).resolves.toMatchObject({ created: true, status: "running" });

    const permissionConflict = createTestBackend();
    await initializeAtS1(permissionConflict);
    await permissionConflict.run(async (ctx) => {
      await ctx.db.insert("roles", {
        legacyId: 8,
        name: "Administrator",
        normalizedName: "administrator",
        description: "Synthetic administrator",
        admin: true,
        permissions: ["wrong"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 8,
        name: "Administrator",
        description: "Synthetic administrator",
        admin: true,
        sourceRowHash: "sha256:permission-conflict",
      });
    });
    await startRun(permissionConflict, {
      users: 0,
      roles: 1,
      userRoles: 0,
    });
    await expectDomainError(
      permissionConflict.mutation(
        internal.migration.identity.transformRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const relationshipCollision = createTestBackend();
    await initializeAtS1(relationshipCollision);
    await relationshipCollision.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        legacyId: "collision-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const roleId = await ctx.db.insert("roles", {
        legacyId: 9,
        name: "Member",
        normalizedName: "member",
        description: "Synthetic member",
        admin: false,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        legacyId: "00000000-0000-0000-0000-000000000090",
        userId,
        roleId,
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "collision-user",
        sourceRowHash: "sha256:collision-user",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 9,
        name: "Member",
        description: "Synthetic member",
        admin: false,
        sourceRowHash: "sha256:collision-role",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000091",
        userLegacyId: "collision-user",
        roleLegacyId: 9,
        sourceRowHash: "sha256:collision-link",
      });
    });
    await startRun(relationshipCollision, {
      users: 1,
      roles: 1,
      userRoles: 1,
    });
    await relationshipCollision.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await relationshipCollision.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    await expectDomainError(
      relationshipCollision.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const legacyLinkConflict = createTestBackend();
    await initializeAtS1(legacyLinkConflict);
    await legacyLinkConflict.run(async (ctx) => {
      const desiredUserId = await ctx.db.insert("users", {
        legacyId: "desired-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const otherUserId = await ctx.db.insert("users", {
        legacyId: "other-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const roleId = await ctx.db.insert("roles", {
        legacyId: 10,
        name: "Member",
        normalizedName: "member",
        description: "Synthetic member",
        admin: false,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        legacyId: "00000000-0000-0000-0000-000000000100",
        userId: otherUserId,
        roleId,
      });
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "desired-user",
        sourceRowHash: "sha256:desired-user",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 10,
        name: "Member",
        description: "Synthetic member",
        admin: false,
        sourceRowHash: "sha256:desired-role",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000100",
        userLegacyId: "desired-user",
        roleLegacyId: 10,
        sourceRowHash: "sha256:desired-link",
      });
      expect(desiredUserId).not.toBe(otherUserId);
    });
    await startRun(legacyLinkConflict, {
      users: 1,
      roles: 1,
      userRoles: 1,
    });
    await legacyLinkConflict.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await legacyLinkConflict.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    await expectDomainError(
      legacyLinkConflict.mutation(
        internal.migration.identity.transformUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("independently reconciles transformed identity documents", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "reconcile-user",
        name: "Synthetic User",
        email: " USER@EXAMPLE.TEST ",
        emailVerifiedAt: 123,
        image: "https://example.test/user.jpg",
        sourceRowHash: "sha256:user",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        name: "Administrator",
        description: "Synthetic administrator",
        admin: true,
        sourceRowHash: "sha256:role",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000201",
        userLegacyId: "reconcile-user",
        roleLegacyId: 1,
        sourceRowHash: "sha256:link",
      });
    });
    await startRun(t, { users: 1, roles: 1, userRoles: 1 });
    await t.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUserRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.userRoles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.finishIdentityRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.finish,
      },
    );

    await reconcileAll(t);
    await expect(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.users,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      checkedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      checkedCount: 1,
    });
    await expect(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      checkedCount: 1,
    });
    const result = await t.mutation(
      internal.migration.identityReconciliation
        .finishIdentityReconciliation,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_RECONCILIATION_OPERATIONS.finish,
      },
    );
    expect(result).toEqual({
      runId: CUTOVER_RUN_ID,
      status: "reconciled",
      users: 1,
      roles: 1,
      userRoles: 1,
    });
    await expect(
      t.mutation(
        internal.migration.identityReconciliation
          .finishIdentityReconciliation,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.finish,
        },
      ),
    ).resolves.toEqual(result);
  });

  test("rolls back identity reconciliation on canonical drift", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawUsers", {
        runId: CUTOVER_RUN_ID,
        legacyId: "drift-user",
        sourceRowHash: "sha256:user",
      });
      await ctx.db.insert("migrationRawRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: 1,
        name: "Member",
        description: "Member",
        admin: false,
        sourceRowHash: "sha256:role",
      });
      await ctx.db.insert("migrationRawUserRoles", {
        runId: CUTOVER_RUN_ID,
        legacyId: "00000000-0000-0000-0000-000000000202",
        userLegacyId: "drift-user",
        roleLegacyId: 1,
        sourceRowHash: "sha256:link",
      });
    });
    await startRun(t, { users: 1, roles: 1, userRoles: 1 });
    await t.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUserRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.userRoles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.finishIdentityRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.finish,
      },
    );
    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", "drift-user"),
        )
        .unique();
      const role = await ctx.db
        .query("roles")
        .withIndex("by_legacyId", (query) =>
          query.eq("legacyId", 1),
        )
        .unique();
      const link = await ctx.db
        .query("userRoles")
        .withIndex("by_legacyId", (query) =>
          query.eq(
            "legacyId",
            "00000000-0000-0000-0000-000000000202",
          ),
        )
        .unique();
      if (!user || !role || !link) {
        throw new Error("Identity reconciliation fixture missing");
      }
      const otherUserId = await ctx.db.insert("users", {
        legacyId: "other-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.patch("users", user._id, {
        status: "disabled",
      });
      await ctx.db.patch("roles", role._id, {
        description: "Drifted",
      });
      await ctx.db.patch("userRoles", link._id, {
        userId: otherUserId,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUserRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId:
            IDENTITY_RECONCILIATION_OPERATIONS.userRoles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
  });

  test("guards identity reconciliation state, cursor, and counts", async () => {
    const t = createTestBackend();
    await initializeAtS1(t);
    await startRun(t, { users: 0, roles: 0, userRoles: 0 });
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.users,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );
    await t.mutation(
      internal.migration.identity.transformRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.roles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUsersBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.users,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.transformUserRolesBatch,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.userRoles,
        batchSize: 10,
      },
    );
    await t.mutation(
      internal.migration.identity.finishIdentityRun,
      {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: IDENTITY_OPERATIONS.finish,
      },
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileUsersBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.users,
          batchSize: 0,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .finishIdentityReconciliation,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("migrationCheckpoints", {
        runId: CUTOVER_RUN_ID,
        operation: IDENTITY_RECONCILIATION_OPERATIONS.roles,
        status: "running",
        lastLegacyKey: "invalid",
        processedCount: 0,
        insertedCount: 0,
        reusedCount: 0,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      t.mutation(
        internal.migration.identityReconciliation
          .reconcileRolesBatch,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.roles,
          batchSize: 10,
        },
      ),
      "CONFLICT",
    );

    const countMismatch = createTestBackend();
    await initializeAtS1(countMismatch);
    await startRun(countMismatch, {
      users: 0,
      roles: 0,
      userRoles: 0,
    });
    await transformAndFinishIdentity(countMismatch);
    await reconcileAll(countMismatch);
    await countMismatch.run(async (ctx) => {
      const checkpoint = await ctx.db
        .query("migrationCheckpoints")
        .withIndex("by_runId_and_operation", (query) =>
          query
            .eq("runId", CUTOVER_RUN_ID)
            .eq(
              "operation",
              IDENTITY_RECONCILIATION_OPERATIONS.users,
            ),
        )
        .unique();
      if (!checkpoint) {
        throw new Error("User reconciliation checkpoint missing");
      }
      await ctx.db.patch("migrationCheckpoints", checkpoint._id, {
        reusedCount: 1,
      });
    });
    await expectDomainError(
      countMismatch.mutation(
        internal.migration.identityReconciliation
          .finishIdentityReconciliation,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: IDENTITY_RECONCILIATION_OPERATIONS.finish,
        },
      ),
      "CONFLICT",
    );
  });
});
