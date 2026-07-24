/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api.js";
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
});
