import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  ASSIGNMENT_RECONCILIATION_OPERATIONS,
} from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
import {
  getMigrationCheckpoint,
  getReconciliationDomainRun,
  reconciliationCheckpointResult,
  requireMigrationBatchSize,
  requireMigrationOperation,
  saveMigrationCheckpoint,
  writeReconciliationBatchAudit,
} from "./runtime.js";

const DOMAIN = "assignments";
const reconciliationResultValidator = v.object({
  operation: v.string(),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
  ),
  checkedCount: v.number(),
});
type DatabaseContext = Pick<MutationCtx, "db">;

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

async function resolveUserId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  if (!user) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a missing user parent.",
    );
  }
  return user._id;
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a missing episode parent.",
    );
  }
  return episode._id;
}

async function resolveMovieId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"movies">> {
  const movie = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!movie) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a missing movie parent.",
    );
  }
  return movie._id;
}

async function resolveAssignmentId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"assignments">> {
  const assignment = await ctx.db
    .query("assignments")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!assignment) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a missing assignment parent.",
    );
  }
  return assignment._id;
}

async function resolveOptionalAssignmentId(
  ctx: DatabaseContext,
  legacyId: string | undefined,
): Promise<Id<"assignments"> | undefined> {
  return legacyId === undefined
    ? undefined
    : await resolveAssignmentId(ctx, legacyId);
}

async function resolvePointId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"points">> {
  const point = await ctx.db
    .query("points")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(legacyId)),
    )
    .unique();
  if (!point) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a missing point parent.",
    );
  }
  return point._id;
}

async function verifyAssignment(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignments">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const episodeId = await resolveEpisodeId(
    ctx,
    row.episodeLegacyId,
  );
  const movieId = await resolveMovieId(ctx, row.movieLegacyId);
  const normalizedSlug =
    row.slug === undefined
      ? undefined
      : normalizeLookupKey(row.slug, "Assignment slug");
  const canonical = await ctx.db
    .query("assignments")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical.episodeId !== episodeId ||
    canonical.movieId !== movieId ||
    canonical.type !== row.type ||
    canonical.playable !== row.playable ||
    canonical.slug !== row.slug ||
    canonical.normalizedSlug !== normalizedSlug
  ) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found an assignment mismatch.",
    );
  }
}

async function verifyAudioMessage(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignmentAudioMessages">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const assignmentId = await resolveOptionalAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const canonical = await ctx.db
    .query("assignmentAudioMessages")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (
    canonical?.url !== row.url ||
    canonical.createdAt !== row.createdAt ||
    canonical.userId !== userId ||
    canonical.assignmentId !== assignmentId ||
    canonical.fileKey !== row.fileKey
  ) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found an audio-message mismatch.",
    );
  }
}

async function verifySyllabusEntry(
  ctx: DatabaseContext,
  row: Doc<"migrationRawSyllabusEntries">,
): Promise<void> {
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const movieId = await resolveMovieId(ctx, row.movieLegacyId);
  const assignmentId = await resolveOptionalAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const canonical = await ctx.db
    .query("syllabusEntries")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.userId !== userId ||
    canonical.movieId !== movieId ||
    canonical.order !== row.order ||
    canonical.createdAt !== row.createdAt ||
    canonical.assignmentId !== assignmentId ||
    canonical.notes !== row.notes
  ) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a syllabus-entry mismatch.",
    );
  }
}

async function verifyPointLink(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignmentPointLinks">,
): Promise<void> {
  const assignmentId = await resolveAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const pointId = await resolvePointId(ctx, row.pointLegacyId);
  const canonical = await ctx.db
    .query("assignmentPointLinks")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalizeUuid(row.legacyId)),
    )
    .unique();
  if (
    canonical?.assignmentId !== assignmentId ||
    canonical.userId !== userId ||
    canonical.pointId !== pointId
  ) {
    domainError(
      "CONFLICT",
      "Assignment reconciliation found a point-link mismatch.",
    );
  }
}

export const reconcileAssignmentsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: reconciliationResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getReconciliationDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
    );
    if (previous?.status === "completed") {
      return reconciliationCheckpointResult(previous);
    }
    const rows = await ctx.db
      .query("migrationRawAssignments")
      .withIndex("by_runId_and_legacyId", (query) => {
        const range = query.eq("runId", runId);
        return previous?.lastLegacyKey === undefined
          ? range
          : range.gt("legacyId", previous.lastLegacyKey);
      })
      .take(args.batchSize + 1);
    const batch = rows.slice(0, args.batchSize);
    const completed = rows.length <= args.batchSize;
    for (const row of batch) {
      await verifyAssignment(ctx, row);
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch: 0,
      reusedThisBatch: batch.length,
      completed,
    });
    await writeReconciliationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
      checkedThisBatch: batch.length,
      completed,
    });
    return reconciliationCheckpointResult(checkpoint);
  },
});

export const reconcileAssignmentAudioMessagesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.audioMessages,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.audioMessages,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const lastLegacyId =
        previous?.lastLegacyKey === undefined
          ? undefined
          : Number(previous.lastLegacyKey);
      if (
        lastLegacyId !== undefined &&
        !Number.isSafeInteger(lastLegacyId)
      ) {
        domainError(
          "CONFLICT",
          "The assignment audio reconciliation cursor is invalid.",
        );
      }
      const rows = await ctx.db
        .query("migrationRawAssignmentAudioMessages")
        .withIndex("by_runId_and_legacyId", (query) => {
          const range = query.eq("runId", runId);
          return lastLegacyId === undefined
            ? range
            : range.gt("legacyId", lastLegacyId);
        })
        .take(args.batchSize + 1);
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verifyAudioMessage(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation:
          ASSIGNMENT_RECONCILIATION_OPERATIONS.audioMessages,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: String(lastRow.legacyId) }),
        processedThisBatch: batch.length,
        insertedThisBatch: 0,
        reusedThisBatch: batch.length,
        completed,
      });
      await writeReconciliationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation:
          ASSIGNMENT_RECONCILIATION_OPERATIONS.audioMessages,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const reconcileSyllabusEntriesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.syllabusEntries,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.syllabusEntries,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const rows = await ctx.db
        .query("migrationRawSyllabusEntries")
        .withIndex("by_runId_and_legacyId", (query) => {
          const range = query.eq("runId", runId);
          return previous?.lastLegacyKey === undefined
            ? range
            : range.gt("legacyId", previous.lastLegacyKey);
        })
        .take(args.batchSize + 1);
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verifySyllabusEntry(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation:
          ASSIGNMENT_RECONCILIATION_OPERATIONS.syllabusEntries,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch: 0,
        reusedThisBatch: batch.length,
        completed,
      });
      await writeReconciliationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation:
          ASSIGNMENT_RECONCILIATION_OPERATIONS.syllabusEntries,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const reconcileAssignmentPointLinksBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: reconciliationResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.pointLinks,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.pointLinks,
      );
      if (previous?.status === "completed") {
        return reconciliationCheckpointResult(previous);
      }
      const rows = await ctx.db
        .query("migrationRawAssignmentPointLinks")
        .withIndex("by_runId_and_legacyId", (query) => {
          const range = query.eq("runId", runId);
          return previous?.lastLegacyKey === undefined
            ? range
            : range.gt("legacyId", previous.lastLegacyKey);
        })
        .take(args.batchSize + 1);
      const batch = rows.slice(0, args.batchSize);
      const completed = rows.length <= args.batchSize;
      for (const row of batch) {
        await verifyPointLink(ctx, row);
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_RECONCILIATION_OPERATIONS.pointLinks,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch: 0,
        reusedThisBatch: batch.length,
        completed,
      });
      await writeReconciliationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: ASSIGNMENT_RECONCILIATION_OPERATIONS.pointLinks,
        checkedThisBatch: batch.length,
        completed,
      });
      return reconciliationCheckpointResult(checkpoint);
    },
  });

export const finishAssignmentReconciliation =
  internalMigrationMutation({
    args: {},
    returns: v.object({
      runId: v.string(),
      status: v.literal("reconciled"),
      assignments: v.number(),
      audioMessages: v.number(),
      syllabusEntries: v.number(),
      pointLinks: v.number(),
    }),
    handler: async (ctx) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.finish,
      );
      const runId = ctx.systemState.cutoverRunId;
      const { domainRun } = await getReconciliationDomainRun(ctx, {
        runId,
        domain: DOMAIN,
      });
      const assignments = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.assignments,
      );
      const audioMessages = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.audioMessages,
      );
      const syllabusEntries = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.syllabusEntries,
      );
      const pointLinks = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_RECONCILIATION_OPERATIONS.pointLinks,
      );
      if (
        assignments?.status !== "completed" ||
        audioMessages?.status !== "completed" ||
        syllabusEntries?.status !== "completed" ||
        pointLinks?.status !== "completed"
      ) {
        domainError(
          "CONFLICT",
          "Every assignment reconciliation checkpoint must be complete.",
        );
      }
      const actualCounts = {
        assignments: assignments.reusedCount,
        audioMessages: audioMessages.reusedCount,
        syllabusEntries: syllabusEntries.reusedCount,
        pointLinks: pointLinks.reusedCount,
      };
      if (
        Object.entries(actualCounts).some(
          ([key, value]) => domainRun.expectedCounts[key] !== value,
        )
      ) {
        domainError(
          "CONFLICT",
          "Assignment reconciliation counts do not match source expectations.",
          { details: actualCounts },
        );
      }
      if (domainRun.status !== "reconciled") {
        await ctx.db.patch("migrationDomainRuns", domainRun._id, {
          status: "reconciled",
          updatedAt: Date.now(),
        });
        await writeAuditEvent(ctx, {
          actor: ctx.actor,
          action: "migration.assignments.reconciled",
          targetType: "migrationDomainRun",
          targetId: domainRun._id,
          cutoverRunId: runId,
          metadata: actualCounts,
        });
      }
      return {
        runId,
        status: "reconciled" as const,
        ...actualCounts,
      };
    },
  });
