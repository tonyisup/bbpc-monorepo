/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import { writeAuditEvent, writeControlAuditEvent } from "./lib/audit.js";
import { assertDomain, domainError } from "./lib/errors.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

const CUTOVER_RUN_ID = "cutover-test-001";
const USER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|user-001",
  issuer: "https://issuer.example.test",
  subject: "user-001",
};
const SERVICE_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|pipeline-001",
  issuer: "https://issuer.example.test",
  subject: "pipeline-001",
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

async function seedUser(
  t: TestBackend,
  options: {
    admin?: boolean;
    host?: boolean;
    status?: "active" | "disabled";
  } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Test User",
      email: "user@example.test",
      normalizedEmail: "user@example.test",
      status: options.status ?? "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("authIdentities", {
      ...USER_IDENTITY,
      userId,
      linkedAt: now,
      lastSeenAt: now,
    });
    if (options.admin === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Synthetic administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: now,
      });
    }
    if (options.host === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Host",
        normalizedName: "host",
        description: "Synthetic host role",
        admin: false,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: now,
      });
    }
    return userId;
  });
}

async function seedService(
  t: TestBackend,
  permissions: string[] = ["pipeline:heartbeat"],
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("servicePrincipals", {
      ...SERVICE_IDENTITY,
      name: "Test Pipeline",
      status: "active",
      permissions,
      cutoverRunId: CUTOVER_RUN_ID,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function initialize(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "test-suite",
  });
}

async function transition(
  t: TestBackend,
  expectedStage: "S0" | "S1" | "S2" | "S3" | "S4",
  nextStage: "S0" | "S1" | "S2" | "S3" | "S4",
  options: {
    approvedBackupId?: string;
    approvedBackupChecksum?: string;
  } = {},
): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage,
    nextStage,
    actor: "test-suite",
    ...options,
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initialize(t);
  await transition(t, "S0", "S1");
  await transition(t, "S1", "S2");
  await transition(t, "S2", "S3", {
    approvedBackupId: "backup-001",
    approvedBackupChecksum: "sha256:abc123",
  });
}

describe("identity boundaries", () => {
  test("exposes only safe anonymous readiness data", async () => {
    const t = createTestBackend();
    await expect(t.query(api.system.health.readiness, {})).resolves.toEqual({
      apiVersion: BBPC_API_VERSION,
      initialized: false,
      applicationWritesEnabled: false,
    });
    await initialize(t);
    await expect(
      t.query(api.system.health.readiness, {}),
    ).resolves.toMatchObject({
      initialized: true,
      applicationWritesEnabled: false,
    });
  });

  test("exposes a non-writing application write-gate probe", async () => {
    const disabled = createTestBackend();
    await expectDomainError(
      disabled.mutation(
        api.system.health.applicationWriteGateProbe,
        { clientApiVersion: BBPC_API_VERSION },
      ),
      "WRITE_DISABLED",
    );

    const enabled = createTestBackend();
    await advanceToS3(enabled);
    await expectDomainError(
      enabled.mutation(
        api.system.health.applicationWriteGateProbe,
        { clientApiVersion: BBPC_API_VERSION },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("requires an authenticated, linked identity", async () => {
    const t = createTestBackend();

    await expectDomainError(
      t.query(api.identity.profile.me, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).query(api.identity.profile.me, {}),
      "IDENTITY_NOT_LINKED",
    );
  });

  test("returns a linked profile and derives administrator status", async () => {
    const t = createTestBackend();
    await seedUser(t, { admin: true, host: true });

    await expect(
      t.withIdentity(USER_IDENTITY).query(api.identity.profile.me, {}),
    ).resolves.toMatchObject({
      name: "Test User",
      email: "user@example.test",
      isAdmin: true,
      isHost: true,
    });
  });

  test("rejects disabled accounts and non-admin access", async () => {
    const disabled = createTestBackend();
    await seedUser(disabled, { status: "disabled" });
    await expectDomainError(
      disabled.withIdentity(USER_IDENTITY).query(api.identity.profile.me, {}),
      "ACCOUNT_DISABLED",
    );

    const member = createTestBackend();
    await seedUser(member);
    await expectDomainError(
      member
        .withIdentity(USER_IDENTITY)
        .query(api.system.cutover.getStatus, {}),
      "FORBIDDEN",
    );
  });

  test("rejects a link whose user record no longer exists", async () => {
    const t = createTestBackend();
    const userId = await seedUser(t);
    await t.run(async (ctx) => ctx.db.delete("users", userId));

    await expectDomainError(
      t.withIdentity(USER_IDENTITY).query(api.identity.profile.me, {}),
      "IDENTITY_CONFLICT",
    );
  });
});

describe("application write gate", () => {
  test("fails closed before system initialization", async () => {
    const t = createTestBackend();
    await seedUser(t);

    await expectDomainError(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyName, {
          clientApiVersion: BBPC_API_VERSION,
          name: "Updated",
        }),
      "WRITE_DISABLED",
    );
  });

  test.each(["S0", "S1", "S2"] as const)(
    "blocks application mutations in %s",
    async (stage) => {
      const t = createTestBackend();
      await seedUser(t);
      await initialize(t);
      if (stage === "S1" || stage === "S2") {
        await transition(t, "S0", "S1");
      }
      if (stage === "S2") {
        await transition(t, "S1", "S2");
      }

      await expectDomainError(
        t
          .withIdentity(USER_IDENTITY)
          .mutation(api.identity.profile.updateMyName, {
            clientApiVersion: BBPC_API_VERSION,
            name: "Updated",
          }),
        "WRITE_DISABLED",
      );
    },
  );

  test("rejects stale clients after writes are enabled", async () => {
    const t = createTestBackend();
    await seedUser(t);
    await advanceToS3(t);

    await expectDomainError(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyName, {
          clientApiVersion: "0.0.0",
          name: "Updated",
        }),
      "STALE_CLIENT",
    );
  });

  test("records the first accepted application write atomically", async () => {
    const t = createTestBackend();
    const userId = await seedUser(t);
    await advanceToS3(t);

    await expect(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyName, {
          clientApiVersion: BBPC_API_VERSION,
          name: "  Updated User  ",
        }),
    ).resolves.toMatchObject({ name: "Updated User" });

    const snapshot = await t.run(async (ctx) => {
      const state = await ctx.db
        .query("systemState")
        .withIndex("by_singletonKey", (query) =>
          query.eq("singletonKey", "global"),
        )
        .unique();
      const user = await ctx.db.get("users", userId);
      const auditEvents = await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
      return { state, user, auditEvents };
    });

    expect(snapshot.state?.firstApplicationWriteAt).toEqual(expect.any(Number));
    expect(snapshot.user?.name).toBe("Updated User");
    expect(snapshot.auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "system.firstApplicationWrite",
        "identity.profile.nameUpdated",
      ]),
    );
  });

  test("validates profile input without writing", async () => {
    const t = createTestBackend();
    await seedUser(t);
    await advanceToS3(t);

    await expectDomainError(
      t
        .withIdentity(USER_IDENTITY)
        .mutation(api.identity.profile.updateMyName, {
          clientApiVersion: BBPC_API_VERSION,
          name: " ",
        }),
      "VALIDATION_FAILED",
    );
  });

  test("applies the write gate to authenticated actions", async () => {
    const disabled = createTestBackend();
    await seedUser(disabled);
    await initialize(disabled);
    await expectDomainError(
      disabled
        .withIdentity(USER_IDENTITY)
        .action(api.identity.profile.actionGateProbe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
      "WRITE_DISABLED",
    );

    const enabled = createTestBackend();
    await seedUser(enabled, { admin: true });
    await advanceToS3(enabled);
    await expect(
      enabled
        .withIdentity(USER_IDENTITY)
        .action(api.identity.profile.actionGateProbe, {
          clientApiVersion: BBPC_API_VERSION,
        }),
    ).resolves.toEqual({
      allowed: true,
      cutoverStage: "S3",
      isAdmin: true,
    });
  });
});

describe("cutover state machine", () => {
  test("requires an approved backup before S3", async () => {
    const t = createTestBackend();
    await initialize(t);
    await transition(t, "S0", "S1");
    await transition(t, "S1", "S2");

    await expectDomainError(transition(t, "S2", "S3"), "VALIDATION_FAILED");
  });

  test("permits S3 rollback only before the first application write", async () => {
    const beforeWrite = createTestBackend();
    await advanceToS3(beforeWrite);
    await expect(transition(beforeWrite, "S3", "S2")).resolves.toBeUndefined();

    const afterWrite = createTestBackend();
    await seedUser(afterWrite);
    await advanceToS3(afterWrite);
    await afterWrite
      .withIdentity(USER_IDENTITY)
      .mutation(api.identity.profile.updateMyName, {
        clientApiVersion: BBPC_API_VERSION,
        name: "Cutover Writer",
      });
    await expectDomainError(
      transition(afterWrite, "S3", "S2"),
      "VALIDATION_FAILED",
    );
  });

  test("detects duplicate initialization and stale transitions", async () => {
    const t = createTestBackend();
    await initialize(t);

    await expectDomainError(initialize(t), "CONFLICT");
    await expectDomainError(transition(t, "S1", "S2"), "CONFLICT");
  });

  test("rejects transitions before initialization and from the wrong run", async () => {
    const uninitialized = createTestBackend();
    await expectDomainError(
      transition(uninitialized, "S0", "S1"),
      "WRITE_DISABLED",
    );

    const wrongRun = createTestBackend();
    await initialize(wrongRun);
    await expectDomainError(
      wrongRun.mutation(internal.system.cutover.transition, {
        cutoverRunId: "wrong-run",
        expectedStage: "S0",
        nextStage: "S1",
        actor: "test-suite",
      }),
      "CONFLICT",
    );
  });

  test("supports the explicit abort and completion transitions", async () => {
    const abortFromS1 = createTestBackend();
    await initialize(abortFromS1);
    await transition(abortFromS1, "S0", "S1");
    await expect(transition(abortFromS1, "S1", "S0")).resolves.toBeUndefined();

    const abortFromS2 = createTestBackend();
    await initialize(abortFromS2);
    await transition(abortFromS2, "S0", "S1");
    await transition(abortFromS2, "S1", "S2");
    await expect(transition(abortFromS2, "S2", "S0")).resolves.toBeUndefined();

    const completed = createTestBackend();
    await advanceToS3(completed);
    await expect(transition(completed, "S3", "S4")).resolves.toBeUndefined();
    await expectDomainError(
      transition(completed, "S4", "S3"),
      "VALIDATION_FAILED",
    );
  });

  test("reports status only to administrators", async () => {
    const t = createTestBackend();
    await seedUser(t, { admin: true });

    await expect(
      t.withIdentity(USER_IDENTITY).query(api.system.cutover.getStatus, {}),
    ).resolves.toEqual({
      initialized: false,
      applicationWriteMode: "disabled",
    });
    await initialize(t);

    await expect(
      t.withIdentity(USER_IDENTITY).query(api.system.cutover.getStatus, {}),
    ).resolves.toMatchObject({
      initialized: true,
      cutoverStage: "S0",
      applicationWriteMode: "disabled",
      apiVersion: BBPC_API_VERSION,
    });
  });
});

describe("pipeline and internal write boundaries", () => {
  test("requires a registered active service principal", async () => {
    const t = createTestBackend();

    await expectDomainError(
      t
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.status.capabilities, {}),
      "FORBIDDEN",
    );
  });

  test("rejects disabled service principals", async () => {
    const t = createTestBackend();
    const servicePrincipalId = await seedService(t);
    await t.run(async (ctx) =>
      ctx.db.patch("servicePrincipals", servicePrincipalId, {
        status: "disabled",
      }),
    );

    await expectDomainError(
      t
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.status.capabilities, {}),
      "FORBIDDEN",
    );
  });

  test("returns registered service capabilities", async () => {
    const t = createTestBackend();
    await seedService(t, ["pipeline:heartbeat", "pipeline:publish"]);

    await expect(
      t
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.status.capabilities, {}),
    ).resolves.toMatchObject({
      name: "Test Pipeline",
      permissions: ["pipeline:heartbeat", "pipeline:publish"],
    });
  });

  test("enforces service permissions and the global write gate", async () => {
    const t = createTestBackend();
    const servicePrincipalId = await seedService(t);
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(SERVICE_IDENTITY).mutation(api.pipeline.status.heartbeat, {
        clientApiVersion: BBPC_API_VERSION,
        requiredPermission: "pipeline:publish",
      }),
      "FORBIDDEN",
    );
    const heartbeat = await t
      .withIdentity(SERVICE_IDENTITY)
      .mutation(api.pipeline.status.heartbeat, {
        clientApiVersion: BBPC_API_VERSION,
        requiredPermission: "pipeline:heartbeat",
      });
    expect(typeof heartbeat.lastSeenAt).toBe("number");

    const service = await t.run(async (ctx) =>
      ctx.db.get("servicePrincipals", servicePrincipalId),
    );
    expect(service?.lastSeenAt).toEqual(expect.any(Number));
  });

  test("applies the same gate to actions", async () => {
    const disabled = createTestBackend();
    await seedService(disabled);
    await initialize(disabled);
    await expectDomainError(
      disabled
        .withIdentity(SERVICE_IDENTITY)
        .action(api.pipeline.status.actionGateProbe, {
          clientApiVersion: BBPC_API_VERSION,
          requiredPermission: "pipeline:heartbeat",
        }),
      "WRITE_DISABLED",
    );

    const enabled = createTestBackend();
    await seedService(enabled);
    await advanceToS3(enabled);
    await expect(
      enabled
        .withIdentity(SERVICE_IDENTITY)
        .action(api.pipeline.status.actionGateProbe, {
          clientApiVersion: BBPC_API_VERSION,
          requiredPermission: "pipeline:heartbeat",
        }),
    ).resolves.toEqual({ allowed: true, cutoverStage: "S3" });
    await expectDomainError(
      enabled
        .withIdentity(SERVICE_IDENTITY)
        .action(api.pipeline.status.actionGateProbe, {
          clientApiVersion: BBPC_API_VERSION,
          requiredPermission: "pipeline:publish",
        }),
      "FORBIDDEN",
    );
  });

  test("rejects disabled action actors before evaluating the write gate", async () => {
    const t = createTestBackend();
    const userId = await seedUser(t, { status: "disabled" });
    const servicePrincipalId = await seedService(t);
    const deletedUserId = await seedUser(t);
    const deletedServicePrincipalId = await seedService(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(servicePrincipalId, { status: "disabled" });
      await ctx.db.delete(deletedUserId);
      await ctx.db.delete(deletedServicePrincipalId);
    });

    await expect(
      t.mutation(internal.system.gate.assertUserActionWriteEnabled, {
        userId,
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).rejects.toThrow("Action user is unavailable");
    await expect(
      t.mutation(internal.system.gate.assertServiceActionWriteEnabled, {
        servicePrincipalId,
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).rejects.toThrow("Action service principal is unavailable");
    await expect(
      t.mutation(internal.system.gate.assertUserActionWriteEnabled, {
        userId: deletedUserId,
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).rejects.toThrow("Action user is unavailable");
    await expect(
      t.mutation(internal.system.gate.assertServiceActionWriteEnabled, {
        servicePrincipalId: deletedServicePrincipalId,
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).rejects.toThrow("Action service principal is unavailable");
  });

  test("gates scheduled writes and migration writes by stage and run", async () => {
    const uninitialized = createTestBackend();
    await expectDomainError(
      uninitialized.mutation(internal.system.gate.assertMigrationWriteEnabled, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: "test-import",
      }),
      "WRITE_DISABLED",
    );

    const t = createTestBackend();
    await initialize(t);

    await expectDomainError(
      t.mutation(internal.system.gate.assertScheduledWriteEnabled, {
        cutoverRunId: CUTOVER_RUN_ID,
        clientApiVersion: BBPC_API_VERSION,
      }),
      "WRITE_DISABLED",
    );
    await expectDomainError(
      t.mutation(internal.system.gate.assertMigrationWriteEnabled, {
        cutoverRunId: "wrong-run",
        operationId: "test-import",
      }),
      "CONFLICT",
    );

    await transition(t, "S0", "S1");
    await expect(
      t.mutation(internal.system.gate.assertMigrationWriteEnabled, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: "test-import",
      }),
    ).resolves.toEqual({
      allowed: true,
      cutoverStage: "S1",
      operationId: "test-import",
    });

    await transition(t, "S1", "S2");
    await transition(t, "S2", "S3", {
      approvedBackupId: "backup-001",
      approvedBackupChecksum: "sha256:abc123",
    });
    await expectDomainError(
      t.mutation(internal.system.gate.assertMigrationWriteEnabled, {
        cutoverRunId: CUTOVER_RUN_ID,
        operationId: "test-import",
      }),
      "WRITE_DISABLED",
    );
    await expect(
      t.mutation(internal.system.gate.assertScheduledWriteEnabled, {
        cutoverRunId: CUTOVER_RUN_ID,
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).resolves.toEqual({ allowed: true, cutoverStage: "S3" });
    await expect(
      t.mutation(internal.system.gate.assertScheduledWriteEnabled, {
        cutoverRunId: "wrong-run",
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).rejects.toThrow("Scheduled write cutover run mismatch");
  });
});

describe("shared error and audit utilities", () => {
  test("supports assertions and incident-safe error metadata", async () => {
    expect(() => {
      assertDomain(true, "INTERNAL_ERROR", "unreachable");
    }).not.toThrow();
    await expectDomainError(
      Promise.resolve().then(() => {
        assertDomain(false, "VALIDATION_FAILED", "invalid");
      }),
      "VALIDATION_FAILED",
    );

    try {
      domainError("INTERNAL_ERROR", "failed", {
        incidentId: "incident-001",
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConvexError);
      if (!(error instanceof ConvexError)) {
        throw error;
      }
      expect(error.data).toMatchObject({
        code: "INTERNAL_ERROR",
        incidentId: "incident-001",
      });
    }
  });

  test("records internal and minimal control audit events", async () => {
    const t = createTestBackend();
    await t.run(async (ctx) => {
      await writeAuditEvent(ctx, {
        actor: { kind: "internal", label: "test" },
        action: "test.internal",
        targetType: "test",
      });
      await writeControlAuditEvent(ctx, {
        actor: "test-suite",
        action: "test.control",
        targetType: "test",
      });
    });

    const events = await t.run(async (ctx) =>
      ctx.db.query("auditEvents").withIndex("by_createdAt").take(10),
    );
    expect(events.map((event) => event.actorType)).toEqual([
      "internal",
      "control",
    ]);
  });
});
