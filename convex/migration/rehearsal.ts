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
const MAX_PORTABLE_AUTH_IDENTITIES = 10_000;
const MAX_PORTABLE_AUDIT_EVENTS = 10_000;
const MAX_S2_ROLLBACK_AUDIT_EVENTS = 2_000;

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

export const inspectUserIdentityEvidence = internalReadQuery({
  args: { runId: v.string() },
  returns: v.object({
    runMatches: v.boolean(),
    cutoverStageS1: v.boolean(),
    cutoverStageS2: v.boolean(),
    applicationWritesDisabled: v.boolean(),
    firstApplicationWriteAbsent: v.boolean(),
    linkedIdentityCount: v.number(),
    linkedUserCount: v.number(),
    linkedActiveUserCount: v.number(),
    linkedAdminUserCount: v.number(),
    preprovisionAuditCount: v.number(),
    ordinaryLinkAuditCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const identities = await ctx.db
      .query("authIdentities")
      .withIndex("by_creation_time")
      .take(100);
    const linkedUserIds = new Set<string>();
    const linkedActiveUserIds = new Set<string>();
    const linkedAdminUserIds = new Set<string>();
    for (const identity of identities) {
      const user = await ctx.db.get("users", identity.userId);
      if (user === null) {
        continue;
      }
      linkedUserIds.add(user._id);
      if (user.status === "active") {
        linkedActiveUserIds.add(user._id);
      }
      const memberships = await ctx.db
        .query("userRoles")
        .withIndex("by_userId", (query) =>
          query.eq("userId", user._id),
        )
        .take(50);
      for (const membership of memberships) {
        const role = await ctx.db.get(
          "roles",
          membership.roleId,
        );
        if (role?.admin === true) {
          linkedAdminUserIds.add(user._id);
          break;
        }
      }
    }
    const auditEvents = await ctx.db
      .query("auditEvents")
      .withIndex(
        "by_cutoverRunId_and_createdAt",
        (query) => query.eq("cutoverRunId", args.runId),
      )
      .order("desc")
      .take(100);
    let preprovisionAuditCount = 0;
    let ordinaryLinkAuditCount = 0;
    for (const event of auditEvents) {
      if (
        event.action ===
        "identity.smokeUser.preprovisioned"
      ) {
        preprovisionAuditCount += 1;
      }
      if (event.action === "identity.linked") {
        ordinaryLinkAuditCount += 1;
      }
    }
    return {
      runMatches: systemState?.cutoverRunId === args.runId,
      cutoverStageS1: systemState?.cutoverStage === "S1",
      cutoverStageS2: systemState?.cutoverStage === "S2",
      applicationWritesDisabled:
        systemState?.applicationWriteMode === "disabled",
      firstApplicationWriteAbsent:
        systemState?.firstApplicationWriteAt === undefined,
      linkedIdentityCount: identities.length,
      linkedUserCount: linkedUserIds.size,
      linkedActiveUserCount: linkedActiveUserIds.size,
      linkedAdminUserCount: linkedAdminUserIds.size,
      preprovisionAuditCount,
      ordinaryLinkAuditCount,
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
    cutoverStageS2: v.boolean(),
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
      cutoverStageS2: systemState?.cutoverStage === "S2",
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

export const inspectS2RollbackEvidence = internalReadQuery({
  args: {
    runId: v.string(),
    actor: v.string(),
  },
  returns: v.object({
    runMatches: v.boolean(),
    cutoverStageS0: v.boolean(),
    applicationWritesDisabled: v.boolean(),
    firstApplicationWriteAbsent: v.boolean(),
    initializationAuditCount: v.number(),
    transitionAuditCount: v.number(),
    transitionSequenceValid: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const systemState = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (query) =>
        query.eq("singletonKey", "global"),
      )
      .unique();
    const auditEvents = await ctx.db
      .query("auditEvents")
      .withIndex(
        "by_cutoverRunId_and_createdAt",
        (query) => query.eq("cutoverRunId", args.runId),
      )
      .order("desc")
      .take(MAX_S2_ROLLBACK_AUDIT_EVENTS + 1);
    if (
      auditEvents.length >
      MAX_S2_ROLLBACK_AUDIT_EVENTS
    ) {
      throw new Error(
        "S2 rollback audit inspection exceeds the audited bound",
      );
    }
    const actorEvents: Array<Doc<"auditEvents">> = [];
    for (const event of auditEvents) {
      if (event.metadata?.actor === args.actor) {
        actorEvents.push(event);
      }
    }
    actorEvents.sort(
      (left, right) =>
        left._creationTime - right._creationTime,
    );
    let initializationAuditCount = 0;
    const transitions: Array<Doc<"auditEvents">> = [];
    for (const event of actorEvents) {
      if (event.action === "system.initialize") {
        initializationAuditCount += 1;
      }
      if (event.action === "system.transition") {
        transitions.push(event);
      }
    }
    const expectedTransitions = [
      ["S0", "S1"],
      ["S1", "S2"],
      ["S2", "S0"],
    ] as const;
    return {
      runMatches: systemState?.cutoverRunId === args.runId,
      cutoverStageS0: systemState?.cutoverStage === "S0",
      applicationWritesDisabled:
        systemState?.applicationWriteMode === "disabled",
      firstApplicationWriteAbsent:
        systemState?.firstApplicationWriteAt === undefined,
      initializationAuditCount,
      transitionAuditCount: transitions.length,
      transitionSequenceValid:
        transitions.length === expectedTransitions.length &&
        expectedTransitions.every(
          ([fromStage, toStage], index) =>
            transitions[index]?.metadata?.fromStage ===
              fromStage &&
            transitions[index]?.metadata?.toStage === toStage &&
            transitions[index]?.metadata
              ?.applicationWriteMode === "disabled",
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
    authIdentitiesCount: v.number(),
    auditEventsCount: v.number(),
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
    const [authIdentities, auditEvents] = await Promise.all([
      ctx.db
        .query("authIdentities")
        .take(MAX_PORTABLE_AUTH_IDENTITIES + 1),
      ctx.db
        .query("auditEvents")
        .take(MAX_PORTABLE_AUDIT_EVENTS + 1),
    ]);
    if (
      authIdentities.length >
        MAX_PORTABLE_AUTH_IDENTITIES ||
      auditEvents.length > MAX_PORTABLE_AUDIT_EVENTS
    ) {
      throw new Error(
        "Portable supplemental table count exceeds the audited bound",
      );
    }
    return {
      portable:
        systemState === null &&
        completionAuditFound &&
        nonemptyTemporaryTables.length === 0,
      systemStatePresent: systemState !== null,
      completionAuditFound,
      nonemptyTemporaryTables,
      nonemptyRetainedTables,
      authIdentitiesCount: authIdentities.length,
      auditEventsCount: auditEvents.length,
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
