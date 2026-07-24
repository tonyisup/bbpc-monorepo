import { v } from "convex/values";

import type { QueryCtx } from "../_generated/server.js";
import { internalReadQuery } from "../functions.js";
import {
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
