/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api.js";
import { MIGRATION_DOMAINS } from "./migration/constants.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

describe("local migration rehearsal preflight", () => {
  test("requires every application and staging table to be empty", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.query(
        internal.migration.rehearsal.inspectFreshTarget,
        {},
      ),
    ).resolves.toEqual({
      fresh: true,
      nonemptyTables: [],
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: "synthetic-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationRawArchivePosts", {
        runId: "synthetic-run",
        legacyId: 1,
        postedAt: 1,
        content: "Synthetic",
        title: "Synthetic",
        sourceRowHash: "sha256:synthetic",
      });
    });

    await expect(
      t.query(
        internal.migration.rehearsal.inspectFreshTarget,
        {},
      ),
    ).resolves.toEqual({
      fresh: false,
      nonemptyTables: [
        "users",
        "migrationRawArchivePosts",
      ],
    });
  });

  test("reports resumable domain and checkpoint progress", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("systemState", {
        singletonKey: "global",
        cutoverStage: "S1",
        applicationWriteMode: "disabled",
        cutoverRunId: "resume-run",
        apiVersion: "2026-07-23",
        initializedAt: 1,
        updatedAt: 1,
        updatedBy: "test",
      });
      await ctx.db.insert("migrationRuns", {
        runId: "resume-run",
        sourceSchemaFingerprint: "source-fingerprint",
        status: "running",
        startedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationDomainRuns", {
        runId: "resume-run",
        domain: "identity",
        status: "transformed",
        expectedCounts: {},
        startedAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("migrationCheckpoints", {
        runId: "resume-run",
        operation: "identity.users",
        status: "completed",
        processedCount: 1,
        insertedCount: 1,
        reusedCount: 0,
        updatedAt: 1,
      });
    });

    await expect(
      t.query(
        internal.migration.rehearsal.inspectRunProgress,
        { runId: "resume-run" },
      ),
    ).resolves.toEqual({
      initialized: true,
      matchesRun: true,
      cutoverStage: "S1",
      apiVersion: "2026-07-23",
      sourceSchemaFingerprint: "source-fingerprint",
      domainStatuses: { identity: "transformed" },
      checkpointStatuses: { "identity.users": "completed" },
    });
    await expect(
      t.query(
        internal.migration.rehearsal.inspectRunProgress,
        { runId: "different-run" },
      ),
    ).resolves.toEqual({
      initialized: true,
      matchesRun: false,
      cutoverStage: "S1",
      apiVersion: "2026-07-23",
      domainStatuses: {},
      checkpointStatuses: {},
    });
  });

  test("reports aggregate-only accepted rehearsal evidence", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("systemState", {
        singletonKey: "global",
        cutoverStage: "S1",
        applicationWriteMode: "disabled",
        cutoverRunId: "evidence-run",
        apiVersion: "2026-07-24",
        initializedAt: 1,
        updatedAt: 1,
        updatedBy: "test",
      });
      await ctx.db.insert("migrationRuns", {
        runId: "evidence-run",
        sourceSchemaFingerprint: "source-fingerprint",
        status: "running",
        startedAt: 10,
        updatedAt: 10,
      });
      for (const [index, domain] of MIGRATION_DOMAINS.entries()) {
        await ctx.db.insert("migrationDomainRuns", {
          runId: "evidence-run",
          domain,
          status: "reconciled",
          expectedCounts:
            domain === "identity"
              ? { users: 19, roles: 6, userRoles: 15 }
              : {},
          startedAt: 20 + index,
          updatedAt: 120 + index,
        });
      }
      await ctx.db.insert("migrationCheckpoints", {
        runId: "evidence-run",
        operation: "identity.users",
        status: "completed",
        processedCount: 19,
        insertedCount: 19,
        reusedCount: 0,
        updatedAt: 30,
      });
      await ctx.db.insert("migrationCheckpoints", {
        runId: "evidence-run",
        operation: "identity.reconcile.users",
        status: "completed",
        processedCount: 19,
        insertedCount: 0,
        reusedCount: 19,
        updatedAt: 40,
      });
    });

    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectRehearsalEvidence,
        { runId: "evidence-run" },
      ),
    ).resolves.toMatchObject({
      runFound: true,
      cutoverStage: "S1",
      apiVersion: "2026-07-24",
      sourceSchemaFingerprint: "source-fingerprint",
      allDomainsReconciled: true,
      totalExpectedRows: 40,
      runDurationMs: 117,
      domainStatuses: Object.fromEntries(
        MIGRATION_DOMAINS.map((domain) => [
          domain,
          "reconciled",
        ]),
      ),
      checkpointSummary: {
        total: 2,
        completed: 2,
        running: 0,
        processedRows: 38,
        insertedRows: 19,
        reusedRows: 19,
      },
    });
  });

  test("reports value-free pipeline identity evidence", async () => {
    const t = convexTest(schema, modules);
    const servicePrincipalId = await t.run(async (ctx) => {
      await ctx.db.insert("systemState", {
        singletonKey: "global",
        cutoverStage: "S1",
        applicationWriteMode: "disabled",
        cutoverRunId: "identity-run",
        apiVersion: "2026-07-24",
        initializedAt: 1,
        updatedAt: 1,
        updatedBy: "test",
      });
      const principalId = await ctx.db.insert(
        "servicePrincipals",
        {
          tokenIdentifier: "synthetic-token",
          issuer: "https://synthetic.clerk.accounts.dev",
          subject: "mch_synthetic",
          name: "Synthetic Pipeline",
          status: "active",
          permissions: ["pipeline:publish"],
          cutoverRunId: "identity-run",
          createdAt: 1,
          updatedAt: 3,
        },
      );
      await ctx.db.insert("auditEvents", {
        actorType: "internal",
        action:
          "identity.pipelineService.preprovisioned",
        targetType: "servicePrincipal",
        targetId: principalId,
        cutoverRunId: "identity-run",
        createdAt: 1,
      });
      await ctx.db.insert("auditEvents", {
        actorType: "internal",
        action:
          "identity.pipelineService.statusChanged",
        targetType: "servicePrincipal",
        targetId: principalId,
        cutoverRunId: "identity-run",
        createdAt: 2,
        metadata: {
          from: "active",
          to: "disabled",
        },
      });
      await ctx.db.insert("auditEvents", {
        actorType: "internal",
        action:
          "identity.pipelineService.statusChanged",
        targetType: "servicePrincipal",
        targetId: principalId,
        cutoverRunId: "identity-run",
        createdAt: 3,
        metadata: {
          from: "disabled",
          to: "active",
        },
      });
      return principalId;
    });

    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectPipelineIdentityEvidence,
        {
          runId: "identity-run",
          servicePrincipalId,
        },
      ),
    ).resolves.toEqual({
      runMatches: true,
      cutoverStageS1: true,
      applicationWritesDisabled: true,
      firstApplicationWriteAbsent: true,
      principalFound: true,
      principalRunMatches: true,
      principalActive: true,
      permissionCount: 1,
      publishOnly: true,
      preprovisionAuditCount: 1,
      statusChangeAuditCount: 2,
      statusChangeTransitionsValid: true,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(
        "servicePrincipals",
        servicePrincipalId,
        {
          status: "disabled",
          permissions: [],
          cutoverRunId: "different-run",
        },
      );
      await ctx.db.insert("auditEvents", {
        actorType: "internal",
        action: "identity.unrelated",
        targetType: "user",
        targetId: "synthetic-user",
        cutoverRunId: "different-run",
        createdAt: 4,
      });
    });
    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectPipelineIdentityEvidence,
        {
          runId: "different-run",
          servicePrincipalId,
        },
      ),
    ).resolves.toEqual({
      runMatches: false,
      cutoverStageS1: true,
      applicationWritesDisabled: true,
      firstApplicationWriteAbsent: true,
      principalFound: true,
      principalRunMatches: true,
      principalActive: false,
      permissionCount: 0,
      publishOnly: false,
      preprovisionAuditCount: 0,
      statusChangeAuditCount: 0,
      statusChangeTransitionsValid: false,
    });
  });

  test("reports value-free user identity evidence", async () => {
    const t = convexTest(schema, modules);
    const { roleId, userId } = await t.run(async (ctx) => {
      await ctx.db.insert("systemState", {
        singletonKey: "global",
        cutoverStage: "S1",
        applicationWriteMode: "disabled",
        cutoverRunId: "identity-run",
        apiVersion: "2026-07-24",
        initializedAt: 1,
        updatedAt: 1,
        updatedBy: "test",
      });
      const userId = await ctx.db.insert("users", {
        legacyId: "synthetic-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const roleId = await ctx.db.insert("roles", {
        legacyId: 1,
        name: "Administrator",
        normalizedName: "administrator",
        description: "Synthetic administrator",
        admin: true,
        permissions: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        legacyId: "synthetic-membership",
        userId,
        roleId,
      });
      await ctx.db.insert("authIdentities", {
        tokenIdentifier: "synthetic-token",
        issuer: "https://synthetic.clerk.accounts.dev",
        subject: "user_synthetic",
        userId,
        linkedAt: 1,
        lastSeenAt: 1,
      });
      await ctx.db.insert("auditEvents", {
        actorType: "internal",
        action: "identity.smokeUser.preprovisioned",
        targetType: "user",
        targetId: userId,
        cutoverRunId: "identity-run",
        createdAt: 1,
      });
      return { roleId, userId };
    });

    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectUserIdentityEvidence,
        { runId: "identity-run" },
      ),
    ).resolves.toEqual({
      runMatches: true,
      cutoverStageS1: true,
      applicationWritesDisabled: true,
      firstApplicationWriteAbsent: true,
      linkedIdentityCount: 1,
      linkedUserCount: 1,
      linkedActiveUserCount: 1,
      linkedAdminUserCount: 1,
      preprovisionAuditCount: 1,
      ordinaryLinkAuditCount: 0,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("users", userId, {
        status: "disabled",
      });
      await ctx.db.patch("roles", roleId, {
        admin: false,
      });
      await ctx.db.insert("auditEvents", {
        actorType: "user",
        actorUserId: userId,
        action: "identity.linked",
        targetType: "user",
        targetId: userId,
        cutoverRunId: "identity-run",
        createdAt: 2,
      });
    });
    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectUserIdentityEvidence,
        { runId: "identity-run" },
      ),
    ).resolves.toMatchObject({
      linkedIdentityCount: 1,
      linkedUserCount: 1,
      linkedActiveUserCount: 0,
      linkedAdminUserCount: 0,
      preprovisionAuditCount: 1,
      ordinaryLinkAuditCount: 1,
    });

    await t.run(async (ctx) => {
      await ctx.db.delete(userId);
    });
    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectUserIdentityEvidence,
        { runId: "identity-run" },
      ),
    ).resolves.toMatchObject({
      linkedIdentityCount: 1,
      linkedUserCount: 0,
      linkedActiveUserCount: 0,
      linkedAdminUserCount: 0,
    });
  });

  test("recognizes only a scrubbed portable target", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        legacyId: "portable-user",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("auditEvents", {
        actorType: "internal",
        action: "migration.portableScrub.completed",
        targetType: "migrationScrubRun",
        targetId: "portable-run",
        cutoverRunId: "portable-run",
        createdAt: 2,
      });
    });
    await expect(
      t.query(
        internal.migration.rehearsal.inspectPortableTarget,
        { runId: "portable-run" },
      ),
    ).resolves.toMatchObject({
      portable: true,
      systemStatePresent: false,
      completionAuditFound: true,
      nonemptyTemporaryTables: [],
      nonemptyRetainedTables: ["users", "auditEvents"],
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("migrationRawUsers", {
        runId: "portable-run",
        legacyId: "unexpected-raw-user",
        sourceRowHash: "sha256:unexpected",
      });
    });
    await expect(
      t.query(
        internal.migration.rehearsal.inspectPortableTarget,
        { runId: "portable-run" },
      ),
    ).resolves.toMatchObject({
      portable: false,
      nonemptyTemporaryTables: ["migrationRawUsers"],
    });
  });

  test("reports resumable final scrub progress", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("systemState", {
        singletonKey: "global",
        cutoverStage: "S1",
        applicationWriteMode: "disabled",
        cutoverRunId: "scrub-run",
        apiVersion: "2026-07-24",
        initializedAt: 1,
        updatedAt: 1,
        updatedBy: "test",
      });
      await ctx.db.insert("migrationScrubRuns", {
        runId: "scrub-run",
        scope: "portable-v1",
        status: "running",
        identityRawRowsDeleted: 0,
        catalogRawRowsDeleted: 0,
        episodeRawRowsDeleted: 0,
        checkpointsDeleted: 0,
        rawRowsDeleted: {
          identity: 40,
        },
        startedAt: 1,
        updatedAt: 2,
      });
    });
    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectFinalScrubProgress,
        { runId: "scrub-run" },
      ),
    ).resolves.toEqual({
      systemStatePresent: true,
      matchesRun: true,
      cutoverStage: "S1",
      scrubStarted: true,
      scrubStatus: "running",
      rawRowsDeleted: { identity: 40 },
    });
  });

  test("fails closed when rehearsal and scrub state are absent", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectRehearsalEvidence,
        { runId: "missing-run" },
      ),
    ).resolves.toMatchObject({
      runFound: false,
      allDomainsReconciled: false,
      totalExpectedRows: 0,
      domainStatuses: {},
      domainExpectedCounts: {},
      domainDurationsMs: {},
      checkpointSummary: {
        total: 0,
        completed: 0,
        running: 0,
        processedRows: 0,
        insertedRows: 0,
        reusedRows: 0,
      },
    });
    await expect(
      t.query(
        internal.migration.rehearsal.inspectPortableTarget,
        { runId: "missing-run" },
      ),
    ).resolves.toEqual({
      portable: false,
      systemStatePresent: false,
      completionAuditFound: false,
      nonemptyTemporaryTables: [],
      nonemptyRetainedTables: [],
      authIdentitiesCount: 0,
      auditEventsCount: 0,
    });
    await expect(
      t.query(
        internal.migration.rehearsal
          .inspectFinalScrubProgress,
        { runId: "missing-run" },
      ),
    ).resolves.toEqual({
      systemStatePresent: false,
      matchesRun: false,
      scrubStarted: false,
      rawRowsDeleted: {},
    });
  });
});
