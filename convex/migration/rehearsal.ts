import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { internalReadQuery } from "../functions.js";
import {
  FINAL_SCRUB_SCOPE,
  MIGRATION_DOMAINS,
  MIGRATION_RAW_TABLES_BY_DOMAIN,
  PORTABLE_BACKUP_TABLES,
  PORTABLE_CONTROL_TABLES,
} from "./constants.js";

type DatabaseContext = Pick<QueryCtx, "db">;
type TableName =
  | (typeof PORTABLE_BACKUP_TABLES)[number]
  | (typeof PORTABLE_CONTROL_TABLES)[number]
  | (typeof MIGRATION_RAW_TABLES_BY_DOMAIN)[keyof typeof MIGRATION_RAW_TABLES_BY_DOMAIN][number];

const ALL_TABLES = [
  ...PORTABLE_BACKUP_TABLES,
  ...PORTABLE_CONTROL_TABLES,
  ...Object.values(MIGRATION_RAW_TABLES_BY_DOMAIN).flat(),
] as const;

async function tableHasRows(
  ctx: DatabaseContext,
  table: TableName,
): Promise<boolean> {
  const row = await ctx.db
    .query(table)
    .withIndex("by_creation_time")
    .first();
  return row !== null;
}

export const inspectFreshTarget = internalReadQuery({
  args: {},
  returns: v.object({
    fresh: v.boolean(),
    nonemptyTables: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const nonemptyTables: string[] = [];
    for (const table of ALL_TABLES) {
      if (await tableHasRows(ctx, table)) {
        nonemptyTables.push(table);
      }
    }
    return {
      fresh: nonemptyTables.length === 0,
      nonemptyTables,
    };
  },
});

export const inspectRunProgress = internalReadQuery({
  args: { runId: v.string() },
  returns: v.object({
    initialized: v.boolean(),
    matchesRun: v.boolean(),
    cutoverStage: v.optional(v.string()),
    apiVersion: v.optional(v.string()),
    sourceSchemaFingerprint: v.optional(v.string()),
    domainStatuses: v.record(v.string(), v.string()),
    checkpointStatuses: v.record(v.string(), v.string()),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const migrationRun = await ctx.db
      .query("migrationRuns")
      .withIndex("by_runId", (query) =>
        query.eq("runId", args.runId),
      )
      .unique();
    const domainRuns = await ctx.db
      .query("migrationDomainRuns")
      .withIndex("by_runId_and_domain", (query) =>
        query.eq("runId", args.runId),
      )
      .take(8);
    const checkpoints = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_runId_and_operation", (query) =>
        query.eq("runId", args.runId),
      )
      .take(100);
    return {
      initialized: systemState !== null,
      matchesRun: systemState?.cutoverRunId === args.runId,
      ...(systemState === null
        ? {}
        : {
            cutoverStage: systemState.cutoverStage,
            apiVersion: systemState.apiVersion,
          }),
      ...(migrationRun === null
        ? {}
        : {
            sourceSchemaFingerprint:
              migrationRun.sourceSchemaFingerprint,
          }),
      domainStatuses: Object.fromEntries(
        domainRuns.map((domainRun) => [
          domainRun.domain,
          domainRun.status,
        ]),
      ),
      checkpointStatuses: Object.fromEntries(
        checkpoints.map((checkpoint) => [
          checkpoint.operation,
          checkpoint.status,
        ]),
      ),
    };
  },
});

export const inspectRehearsalEvidence = internalReadQuery({
  args: { runId: v.string() },
  returns: v.object({
    runFound: v.boolean(),
    cutoverStage: v.optional(v.string()),
    apiVersion: v.optional(v.string()),
    sourceSchemaFingerprint: v.optional(v.string()),
    allDomainsReconciled: v.boolean(),
    totalExpectedRows: v.number(),
    runDurationMs: v.optional(v.number()),
    domainStatuses: v.record(v.string(), v.string()),
    domainExpectedCounts: v.record(
      v.string(),
      v.record(v.string(), v.number()),
    ),
    domainDurationsMs: v.record(v.string(), v.number()),
    checkpointSummary: v.object({
      total: v.number(),
      completed: v.number(),
      running: v.number(),
      processedRows: v.number(),
      insertedRows: v.number(),
      reusedRows: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const migrationRun = await ctx.db
      .query("migrationRuns")
      .withIndex("by_runId", (query) =>
        query.eq("runId", args.runId),
      )
      .unique();
    const domainRuns = await ctx.db
      .query("migrationDomainRuns")
      .withIndex("by_runId_and_domain", (query) =>
        query.eq("runId", args.runId),
      )
      .take(MIGRATION_DOMAINS.length);
    const checkpoints = await ctx.db
      .query("migrationCheckpoints")
      .withIndex("by_runId_and_operation", (query) =>
        query.eq("runId", args.runId),
      )
      .take(100);
    const domainStatuses = Object.fromEntries(
      domainRuns.map((domainRun) => [
        domainRun.domain,
        domainRun.status,
      ]),
    );
    const domainExpectedCounts = Object.fromEntries(
      domainRuns.map((domainRun) => [
        domainRun.domain,
        domainRun.expectedCounts,
      ]),
    );
    const domainDurationsMs = Object.fromEntries(
      domainRuns.map((domainRun) => [
        domainRun.domain,
        Math.max(0, domainRun.updatedAt - domainRun.startedAt),
      ]),
    );
    const latestDomainUpdate = domainRuns.reduce(
      (latest, domainRun) =>
        Math.max(latest, domainRun.updatedAt),
      migrationRun?.startedAt ?? 0,
    );
    return {
      runFound: migrationRun !== null,
      ...(systemState === null
        ? {}
        : {
            cutoverStage: systemState.cutoverStage,
            apiVersion: systemState.apiVersion,
          }),
      ...(migrationRun === null
        ? {}
        : {
            sourceSchemaFingerprint:
              migrationRun.sourceSchemaFingerprint,
            runDurationMs: Math.max(
              0,
              latestDomainUpdate - migrationRun.startedAt,
            ),
          }),
      allDomainsReconciled:
        domainRuns.length === MIGRATION_DOMAINS.length &&
        MIGRATION_DOMAINS.every(
          (domain) => domainStatuses[domain] === "reconciled",
        ),
      totalExpectedRows: domainRuns.reduce(
        (total, domainRun) =>
          total +
          Object.values(domainRun.expectedCounts).reduce(
            (domainTotal, count) => domainTotal + count,
            0,
          ),
        0,
      ),
      domainStatuses,
      domainExpectedCounts,
      domainDurationsMs,
      checkpointSummary: {
        total: checkpoints.length,
        completed: checkpoints.reduce(
          (total, checkpoint) =>
            total +
            (checkpoint.status === "completed" ? 1 : 0),
          0,
        ),
        running: checkpoints.reduce(
          (total, checkpoint) =>
            total + (checkpoint.status === "running" ? 1 : 0),
          0,
        ),
        processedRows: checkpoints.reduce(
          (total, checkpoint) =>
            total + checkpoint.processedCount,
          0,
        ),
        insertedRows: checkpoints.reduce(
          (total, checkpoint) =>
            total + checkpoint.insertedCount,
          0,
        ),
        reusedRows: checkpoints.reduce(
          (total, checkpoint) =>
            total + checkpoint.reusedCount,
          0,
        ),
      },
    };
  },
});

export const inspectPipelineIdentityEvidence = internalReadQuery({
  args: {
    runId: v.string(),
    servicePrincipalId: v.id("servicePrincipals"),
  },
  returns: v.object({
    runMatches: v.boolean(),
    cutoverStageS1: v.boolean(),
    applicationWritesDisabled: v.boolean(),
    firstApplicationWriteAbsent: v.boolean(),
    principalFound: v.boolean(),
    principalRunMatches: v.boolean(),
    principalActive: v.boolean(),
    permissionCount: v.number(),
    publishOnly: v.boolean(),
    preprovisionAuditCount: v.number(),
    statusChangeAuditCount: v.number(),
    statusChangeTransitionsValid: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const principal = await ctx.db.get(
      "servicePrincipals",
      args.servicePrincipalId,
    );
    const auditEvents = await ctx.db
      .query("auditEvents")
      .withIndex(
        "by_cutoverRunId_and_createdAt",
        (query) => query.eq("cutoverRunId", args.runId),
      )
      .order("desc")
      .take(100);
    let preprovisionAuditCount = 0;
    const statusChanges: Array<Doc<"auditEvents">> = [];
    for (const event of auditEvents) {
      if (
        event.targetType !== "servicePrincipal" ||
        event.targetId !== args.servicePrincipalId
      ) {
        continue;
      }
      if (
        event.action ===
        "identity.pipelineService.preprovisioned"
      ) {
        preprovisionAuditCount += 1;
      }
      if (
        event.action ===
        "identity.pipelineService.statusChanged"
      ) {
        statusChanges.push(event);
      }
    }
    statusChanges.sort(
      (left, right) =>
        left.createdAt - right.createdAt,
    );
    const expectedTransitions = [
      ["active", "disabled"],
      ["disabled", "active"],
    ] as const;
    return {
      runMatches: systemState?.cutoverRunId === args.runId,
      cutoverStageS1: systemState?.cutoverStage === "S1",
      applicationWritesDisabled:
        systemState?.applicationWriteMode === "disabled",
      firstApplicationWriteAbsent:
        systemState?.firstApplicationWriteAt === undefined,
      principalFound: principal !== null,
      principalRunMatches:
        principal?.cutoverRunId === args.runId,
      principalActive: principal?.status === "active",
      permissionCount: principal?.permissions.length ?? 0,
      publishOnly:
        principal?.permissions.length === 1 &&
        principal.permissions[0] === "pipeline:publish",
      preprovisionAuditCount,
      statusChangeAuditCount: statusChanges.length,
      statusChangeTransitionsValid:
        statusChanges.length === expectedTransitions.length &&
        expectedTransitions.every(
          ([from, to], index) =>
            statusChanges[index]?.metadata?.from === from &&
            statusChanges[index]?.metadata?.to === to,
        ),
    };
  },
});

export const inspectPortableTarget = internalReadQuery({
  args: { runId: v.string() },
  returns: v.object({
    portable: v.boolean(),
    systemStatePresent: v.boolean(),
    completionAuditFound: v.boolean(),
    nonemptyTemporaryTables: v.array(v.string()),
    nonemptyRetainedTables: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const latestRunAudit = await ctx.db
      .query("auditEvents")
      .withIndex(
        "by_cutoverRunId_and_createdAt",
        (query) => query.eq("cutoverRunId", args.runId),
      )
      .order("desc")
      .first();
    const temporaryTables = [
      ...PORTABLE_CONTROL_TABLES,
      ...Object.values(MIGRATION_RAW_TABLES_BY_DOMAIN).flat(),
    ] as const;
    const nonemptyTemporaryTables: string[] = [];
    for (const table of temporaryTables) {
      if (await tableHasRows(ctx, table)) {
        nonemptyTemporaryTables.push(table);
      }
    }
    const nonemptyRetainedTables: string[] = [];
    for (const table of PORTABLE_BACKUP_TABLES) {
      if (await tableHasRows(ctx, table)) {
        nonemptyRetainedTables.push(table);
      }
    }
    const completionAuditFound =
      latestRunAudit?.action ===
      "migration.portableScrub.completed";
    return {
      portable:
        systemState === null &&
        completionAuditFound &&
        nonemptyTemporaryTables.length === 0,
      systemStatePresent: systemState !== null,
      completionAuditFound,
      nonemptyTemporaryTables,
      nonemptyRetainedTables,
    };
  },
});

export const inspectFinalScrubProgress = internalReadQuery({
  args: { runId: v.string() },
  returns: v.object({
    systemStatePresent: v.boolean(),
    matchesRun: v.boolean(),
    cutoverStage: v.optional(v.string()),
    scrubStarted: v.boolean(),
    scrubStatus: v.optional(v.string()),
    rawRowsDeleted: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const scrubRun = await ctx.db
      .query("migrationScrubRuns")
      .withIndex("by_runId_and_scope", (query) =>
        query
          .eq("runId", args.runId)
          .eq("scope", FINAL_SCRUB_SCOPE),
      )
      .unique();
    return {
      systemStatePresent: systemState !== null,
      matchesRun: systemState?.cutoverRunId === args.runId,
      ...(systemState === null
        ? {}
        : { cutoverStage: systemState.cutoverStage }),
      scrubStarted: scrubRun !== null,
      ...(scrubRun === null
        ? {}
        : { scrubStatus: scrubRun.status }),
      rawRowsDeleted: scrubRun?.rawRowsDeleted ?? {},
    };
  },
});
