import type { Doc } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { SOURCE_SCHEMA_FINGERPRINT } from "./constants.js";

type DatabaseContext = Pick<MutationCtx, "db">;

export interface ActiveDomainRun {
  run: Doc<"migrationRuns">;
  domainRun: Doc<"migrationDomainRuns">;
}

export interface CheckpointSummary {
  operation: string;
  status: "running" | "completed";
  processedCount: number;
  insertedCount: number;
  reusedCount: number;
}

export interface ReconciliationCheckpointSummary {
  operation: string;
  status: "running" | "completed";
  checkedCount: number;
}

export function requireMigrationOperation(
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    domainError(
      "VALIDATION_FAILED",
      "The migration operation identifier is invalid.",
      {
        details: {
          expectedOperation: expected,
          receivedOperation: actual,
        },
      },
    );
  }
}

export function requireMigrationCount(
  value: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000_000
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a non-negative safe integer.`,
    );
  }
}

export function requireMigrationBatchSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    domainError(
      "VALIDATION_FAILED",
      "Migration batch size must be an integer from 1 through 100.",
    );
  }
}

function countsSignature(counts: Record<string, number>): string {
  return Object.keys(counts)
    .sort()
    .map((key) => `${key}:${String(counts[key])}`)
    .join("|");
}

export async function startDomainRun(
  ctx: DatabaseContext,
  input: {
    runId: string;
    domain: string;
    sourceSchemaFingerprint: string;
    expectedCounts: Record<string, number>;
  },
): Promise<{
  run: Pick<Doc<"migrationRuns">, "runId" | "status">;
  domainRun: Pick<
    Doc<"migrationDomainRuns">,
    "_id" | "status"
  >;
  created: boolean;
}> {
  if (input.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT) {
    domainError(
      "CONFLICT",
      "The migration source schema fingerprint does not match the approved census.",
    );
  }

  const existingRun = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runId", (query) =>
      query.eq("runId", input.runId),
    )
    .unique();
  if (
    existingRun &&
    (existingRun.sourceSchemaFingerprint !==
      input.sourceSchemaFingerprint ||
      existingRun.status !== "running")
  ) {
    domainError(
      "CONFLICT",
      "The existing migration run is not compatible with this domain.",
    );
  }

  const existingDomainRun = await ctx.db
    .query("migrationDomainRuns")
    .withIndex("by_runId_and_domain", (query) =>
      query.eq("runId", input.runId).eq("domain", input.domain),
    )
    .unique();
  if (existingDomainRun) {
    if (
      countsSignature(existingDomainRun.expectedCounts) !==
      countsSignature(input.expectedCounts)
    ) {
      domainError(
        "CONFLICT",
        "The existing domain migration has different source expectations.",
      );
    }
    if (!existingRun) {
      domainError(
        "CONFLICT",
        "The domain migration exists without its global migration run.",
      );
    }
    return {
      run: existingRun,
      domainRun: existingDomainRun,
      created: false,
    };
  }

  const now = Date.now();
  if (!existingRun) {
    await ctx.db.insert("migrationRuns", {
      runId: input.runId,
      sourceSchemaFingerprint: input.sourceSchemaFingerprint,
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
  }
  const domainRunId = await ctx.db.insert("migrationDomainRuns", {
    runId: input.runId,
    domain: input.domain,
    status: "running",
    expectedCounts: input.expectedCounts,
    startedAt: now,
    updatedAt: now,
  });
  return {
    run: existingRun ?? {
      runId: input.runId,
      status: "running",
    },
    domainRun: {
      _id: domainRunId,
      status: "running",
    },
    created: true,
  };
}

export async function getActiveDomainRun(
  ctx: DatabaseContext,
  input: { runId: string; domain: string },
): Promise<ActiveDomainRun> {
  const run = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runId", (query) =>
      query.eq("runId", input.runId),
    )
    .unique();
  if (!run) {
    domainError(
      "CONFLICT",
      "The global migration run has not been started.",
    );
  }
  if (run.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT) {
    domainError(
      "CONFLICT",
      "The migration source schema fingerprint does not match.",
    );
  }
  if (run.status !== "running") {
    domainError(
      "CONFLICT",
      "The global migration run is not accepting transform batches.",
      { details: { runStatus: run.status } },
    );
  }

  const domainRun = await ctx.db
    .query("migrationDomainRuns")
    .withIndex("by_runId_and_domain", (query) =>
      query.eq("runId", input.runId).eq("domain", input.domain),
    )
    .unique();
  if (!domainRun) {
    domainError(
      "CONFLICT",
      "The domain migration has not been started.",
    );
  }
  if (domainRun.status !== "running") {
    domainError(
      "CONFLICT",
      "The domain is not accepting transform batches.",
      { details: { domainStatus: domainRun.status } },
    );
  }
  return { run, domainRun };
}

export async function requireTransformedDomain(
  ctx: DatabaseContext,
  input: { runId: string; domain: string },
): Promise<Doc<"migrationDomainRuns">> {
  const domainRun = await ctx.db
    .query("migrationDomainRuns")
    .withIndex("by_runId_and_domain", (query) =>
      query.eq("runId", input.runId).eq("domain", input.domain),
    )
    .unique();
  if (domainRun?.status !== "transformed") {
    domainError(
      "CONFLICT",
      `The ${input.domain} migration domain must be transformed first.`,
    );
  }
  return domainRun;
}

export async function getReconciliationDomainRun(
  ctx: DatabaseContext,
  input: { runId: string; domain: string },
): Promise<ActiveDomainRun> {
  const run = await ctx.db
    .query("migrationRuns")
    .withIndex("by_runId", (query) =>
      query.eq("runId", input.runId),
    )
    .unique();
  if (
    run?.sourceSchemaFingerprint !== SOURCE_SCHEMA_FINGERPRINT ||
    run.status !== "running"
  ) {
    domainError(
      "CONFLICT",
      "The global migration run is not available for reconciliation.",
    );
  }
  const domainRun = await ctx.db
    .query("migrationDomainRuns")
    .withIndex("by_runId_and_domain", (query) =>
      query.eq("runId", input.runId).eq("domain", input.domain),
    )
    .unique();
  if (
    domainRun?.status !== "transformed" &&
    domainRun?.status !== "reconciled"
  ) {
    domainError(
      "CONFLICT",
      "The migration domain is not ready for reconciliation.",
    );
  }
  return { run, domainRun };
}

export async function getMigrationCheckpoint(
  ctx: DatabaseContext,
  runId: string,
  operation: string,
): Promise<Doc<"migrationCheckpoints"> | null> {
  return await ctx.db
    .query("migrationCheckpoints")
    .withIndex("by_runId_and_operation", (query) =>
      query.eq("runId", runId).eq("operation", operation),
    )
    .unique();
}

export async function saveMigrationCheckpoint(
  ctx: DatabaseContext,
  input: {
    runId: string;
    operation: string;
    previous: Doc<"migrationCheckpoints"> | null;
    lastLegacyKey?: string;
    processedThisBatch: number;
    insertedThisBatch: number;
    reusedThisBatch: number;
    completed: boolean;
  },
): Promise<CheckpointSummary> {
  const values = {
    runId: input.runId,
    operation: input.operation,
    status: input.completed ? ("completed" as const) : ("running" as const),
    processedCount:
      (input.previous?.processedCount ?? 0) +
      input.processedThisBatch,
    insertedCount:
      (input.previous?.insertedCount ?? 0) +
      input.insertedThisBatch,
    reusedCount:
      (input.previous?.reusedCount ?? 0) + input.reusedThisBatch,
    updatedAt: Date.now(),
    ...(input.lastLegacyKey === undefined
      ? {}
      : { lastLegacyKey: input.lastLegacyKey }),
  };
  if (input.previous) {
    await ctx.db.replace(
      "migrationCheckpoints",
      input.previous._id,
      values,
    );
  } else {
    await ctx.db.insert("migrationCheckpoints", values);
  }
  return values;
}

export function migrationCheckpointResult(
  checkpoint: CheckpointSummary,
): CheckpointSummary {
  return {
    operation: checkpoint.operation,
    status: checkpoint.status,
    processedCount: checkpoint.processedCount,
    insertedCount: checkpoint.insertedCount,
    reusedCount: checkpoint.reusedCount,
  };
}

export function reconciliationCheckpointResult(
  checkpoint: CheckpointSummary,
): ReconciliationCheckpointSummary {
  return {
    operation: checkpoint.operation,
    status: checkpoint.status,
    checkedCount: checkpoint.reusedCount,
  };
}

export async function writeMigrationBatchAudit(
  ctx: Parameters<typeof writeAuditEvent>[0],
  input: {
    runId: string;
    domain: string;
    operation: string;
    processedThisBatch: number;
    insertedThisBatch: number;
    reusedThisBatch: number;
    completed: boolean;
  },
): Promise<void> {
  await writeAuditEvent(ctx, {
    actor: {
      kind: "internal",
      label: `migration:${input.operation}`,
    },
    action: "migration.domain.batch",
    targetType: "migrationRun",
    targetId: input.runId,
    cutoverRunId: input.runId,
    metadata: {
      domain: input.domain,
      operation: input.operation,
      processed: input.processedThisBatch,
      inserted: input.insertedThisBatch,
      reused: input.reusedThisBatch,
      completed: input.completed,
    },
  });
}

export async function writeReconciliationBatchAudit(
  ctx: Parameters<typeof writeAuditEvent>[0],
  input: {
    runId: string;
    domain: string;
    operation: string;
    checkedThisBatch: number;
    completed: boolean;
  },
): Promise<void> {
  await writeAuditEvent(ctx, {
    actor: {
      kind: "internal",
      label: `migration:${input.operation}`,
    },
    action: "migration.domain.reconciliationBatch",
    targetType: "migrationRun",
    targetId: input.runId,
    cutoverRunId: input.runId,
    metadata: {
      domain: input.domain,
      operation: input.operation,
      checked: input.checkedThisBatch,
      completed: input.completed,
    },
  });
}
