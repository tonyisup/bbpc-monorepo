import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalMigrationMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  ASSIGNMENT_OPERATIONS,
  GAME_OPERATIONS,
} from "./constants.js";
import { normalizeLookupKey } from "./normalize.js";
import {
  getActiveDomainRun,
  getMigrationCheckpoint,
  migrationCheckpointResult,
  requireCompletedMigrationCheckpoint,
  requireMigrationBatchSize,
  requireMigrationCount,
  requireMigrationOperation,
  requireReconciledDomain,
  saveMigrationCheckpoint,
  startDomainRun,
  writeMigrationBatchAudit,
} from "./runtime.js";

const DOMAIN = "assignments";
const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("transformed"),
  v.literal("reconciled"),
  v.literal("failed"),
);
const checkpointStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
);
const checkpointResultValidator = v.object({
  operation: v.string(),
  status: checkpointStatusValidator,
  processedCount: v.number(),
  insertedCount: v.number(),
  reusedCount: v.number(),
});

type DatabaseContext = Pick<MutationCtx, "db">;
type UpsertOutcome = "inserted" | "reused";

function normalizeUuid(value: string, label: string): string {
  const normalized = value.toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  ) {
    domainError("VALIDATION_FAILED", `${label} must be a UUID.`);
  }
  return normalized;
}

function requireSqlInt(value: number, label: string): void {
  if (
    !Number.isSafeInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must fit the SQL int range.`,
    );
  }
}

function requireFiniteTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a finite timestamp.`,
    );
  }
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
      "An assignment record references a missing canonical user.",
    );
  }
  return user._id;
}

async function resolveEpisodeId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"episodes">> {
  const normalized = normalizeUuid(
    legacyId,
    "Assignment episode relationship ID",
  );
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!episode) {
    domainError(
      "CONFLICT",
      "An assignment record references a missing canonical episode.",
    );
  }
  return episode._id;
}

async function resolveMovieId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"movies">> {
  const normalized = normalizeUuid(
    legacyId,
    "Assignment movie relationship ID",
  );
  const movie = await ctx.db
    .query("movies")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!movie) {
    domainError(
      "CONFLICT",
      "An assignment record references a missing canonical movie.",
    );
  }
  return movie._id;
}

async function resolveAssignmentId(
  ctx: DatabaseContext,
  legacyId: string,
): Promise<Id<"assignments">> {
  const normalized = normalizeUuid(
    legacyId,
    "Assignment relationship ID",
  );
  const assignment = await ctx.db
    .query("assignments")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!assignment) {
    domainError(
      "CONFLICT",
      "An assignment child references a missing canonical assignment.",
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
  const normalized = normalizeUuid(
    legacyId,
    "Assignment point relationship ID",
  );
  const point = await ctx.db
    .query("points")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", normalized),
    )
    .unique();
  if (!point) {
    domainError(
      "CONFLICT",
      "An assignment point link references a missing canonical point.",
    );
  }
  return point._id;
}

async function upsertAssignment(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignments">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Assignment legacy ID",
  );
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
  const existing = await ctx.db
    .query("assignments")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const slugCollision =
    normalizedSlug === undefined
      ? null
      : await ctx.db
          .query("assignments")
          .withIndex("by_normalizedSlug", (query) =>
            query.eq("normalizedSlug", normalizedSlug),
          )
          .unique();
  if (slugCollision && slugCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Assignment slug normalization produced a duplicate canonical key.",
    );
  }
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.episodeId === episodeId &&
      existing.movieId === movieId &&
      existing.type === row.type &&
      existing.playable === row.playable &&
      existing.slug === row.slug &&
      existing.normalizedSlug === normalizedSlug;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated assignment conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("assignments", {
    legacyId,
    userId,
    episodeId,
    movieId,
    type: row.type,
    playable: row.playable,
    ...(row.slug === undefined ? {} : { slug: row.slug }),
    ...(normalizedSlug === undefined ? {} : { normalizedSlug }),
  });
  return "inserted";
}

async function upsertAssignmentAudioMessage(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignmentAudioMessages">,
): Promise<UpsertOutcome> {
  requireSqlInt(row.legacyId, "Assignment audio message legacy ID");
  requireFiniteTimestamp(
    row.createdAt,
    "Assignment audio message creation time",
  );
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const assignmentId = await resolveOptionalAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const existing = await ctx.db
    .query("assignmentAudioMessages")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", row.legacyId),
    )
    .unique();
  if (existing) {
    const matches =
      existing.url === row.url &&
      existing.createdAt === row.createdAt &&
      existing.userId === userId &&
      existing.assignmentId === assignmentId &&
      existing.fileKey === row.fileKey;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated assignment audio message conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("assignmentAudioMessages", {
    legacyId: row.legacyId,
    url: row.url,
    createdAt: row.createdAt,
    userId,
    ...(assignmentId === undefined ? {} : { assignmentId }),
    ...(row.fileKey === undefined ? {} : { fileKey: row.fileKey }),
  });
  return "inserted";
}

async function upsertSyllabusEntry(
  ctx: DatabaseContext,
  row: Doc<"migrationRawSyllabusEntries">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Syllabus entry legacy ID",
  );
  requireSqlInt(row.order, "Syllabus order");
  requireFiniteTimestamp(row.createdAt, "Syllabus creation time");
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const movieId = await resolveMovieId(ctx, row.movieLegacyId);
  const assignmentId = await resolveOptionalAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const existing = await ctx.db
    .query("syllabusEntries")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const orderCollision = await ctx.db
    .query("syllabusEntries")
    .withIndex("by_userId_and_order", (query) =>
      query.eq("userId", userId).eq("order", row.order),
    )
    .unique();
  if (orderCollision && orderCollision._id !== existing?._id) {
    domainError(
      "CONFLICT",
      "Syllabus migration produced a duplicate user ordering key.",
    );
  }
  if (existing) {
    const matches =
      existing.userId === userId &&
      existing.movieId === movieId &&
      existing.order === row.order &&
      existing.createdAt === row.createdAt &&
      existing.assignmentId === assignmentId &&
      existing.notes === row.notes;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated syllabus entry conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("syllabusEntries", {
    legacyId,
    userId,
    movieId,
    order: row.order,
    createdAt: row.createdAt,
    ...(assignmentId === undefined ? {} : { assignmentId }),
    ...(row.notes === undefined ? {} : { notes: row.notes }),
  });
  return "inserted";
}

async function upsertAssignmentPointLink(
  ctx: DatabaseContext,
  row: Doc<"migrationRawAssignmentPointLinks">,
): Promise<UpsertOutcome> {
  const legacyId = normalizeUuid(
    row.legacyId,
    "Assignment point link legacy ID",
  );
  const assignmentId = await resolveAssignmentId(
    ctx,
    row.assignmentLegacyId,
  );
  const userId = await resolveUserId(ctx, row.userLegacyId);
  const pointId = await resolvePointId(ctx, row.pointLegacyId);
  const existing = await ctx.db
    .query("assignmentPointLinks")
    .withIndex("by_legacyId", (query) =>
      query.eq("legacyId", legacyId),
    )
    .unique();
  const relationshipCollision = await ctx.db
    .query("assignmentPointLinks")
    .withIndex(
      "by_assignmentId_and_userId_and_pointId",
      (query) =>
        query
          .eq("assignmentId", assignmentId)
          .eq("userId", userId)
          .eq("pointId", pointId),
    )
    .unique();
  if (
    relationshipCollision &&
    relationshipCollision._id !== existing?._id
  ) {
    domainError(
      "CONFLICT",
      "Assignment point migration produced a duplicate relationship.",
    );
  }
  if (existing) {
    const matches =
      existing.assignmentId === assignmentId &&
      existing.userId === userId &&
      existing.pointId === pointId;
    if (!matches) {
      domainError(
        "CONFLICT",
        "A migrated assignment point link conflicts with its canonical document.",
      );
    }
    return "reused";
  }
  await ctx.db.insert("assignmentPointLinks", {
    legacyId,
    assignmentId,
    userId,
    pointId,
  });
  return "inserted";
}

export const startAssignmentRun = internalMigrationMutation({
  args: {
    sourceSchemaFingerprint: v.string(),
    expectedAssignments: v.number(),
    expectedAudioMessages: v.number(),
    expectedSyllabusEntries: v.number(),
    expectedPointLinks: v.number(),
  },
  returns: v.object({
    runId: v.string(),
    status: runStatusValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      ASSIGNMENT_OPERATIONS.start,
    );
    requireMigrationCount(
      args.expectedAssignments,
      "Expected assignment count",
    );
    requireMigrationCount(
      args.expectedAudioMessages,
      "Expected assignment audio message count",
    );
    requireMigrationCount(
      args.expectedSyllabusEntries,
      "Expected syllabus entry count",
    );
    requireMigrationCount(
      args.expectedPointLinks,
      "Expected assignment point link count",
    );
    const runId = ctx.systemState.cutoverRunId;
    for (const domain of ["identity", "catalog", "episodes"]) {
      await requireReconciledDomain(ctx, { runId, domain });
    }
    const result = await startDomainRun(ctx, {
      runId,
      domain: DOMAIN,
      sourceSchemaFingerprint: args.sourceSchemaFingerprint,
      expectedCounts: {
        assignments: args.expectedAssignments,
        audioMessages: args.expectedAudioMessages,
        syllabusEntries: args.expectedSyllabusEntries,
        pointLinks: args.expectedPointLinks,
      },
    });
    if (result.created) {
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.assignments.started",
        targetType: "migrationDomainRun",
        targetId: result.domainRun._id,
        cutoverRunId: result.run.runId,
        metadata: {
          expectedAssignments: args.expectedAssignments,
          expectedAudioMessages: args.expectedAudioMessages,
          expectedSyllabusEntries: args.expectedSyllabusEntries,
          expectedPointLinks: args.expectedPointLinks,
        },
      });
    }
    return {
      runId: result.run.runId,
      status: result.domainRun.status,
      created: result.created,
    };
  },
});

export const transformAssignmentsBatch = internalMigrationMutation({
  args: { batchSize: v.number() },
  returns: checkpointResultValidator,
  handler: async (ctx, args) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      ASSIGNMENT_OPERATIONS.assignments,
    );
    requireMigrationBatchSize(args.batchSize);
    const runId = ctx.systemState.cutoverRunId;
    await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
    const previous = await getMigrationCheckpoint(
      ctx,
      runId,
      ASSIGNMENT_OPERATIONS.assignments,
    );
    if (previous?.status === "completed") {
      return migrationCheckpointResult(previous);
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
    let insertedThisBatch = 0;
    let reusedThisBatch = 0;
    for (const row of batch) {
      const outcome = await upsertAssignment(ctx, row);
      if (outcome === "inserted") {
        insertedThisBatch += 1;
      } else {
        reusedThisBatch += 1;
      }
    }
    const lastRow = batch.at(-1);
    const checkpoint = await saveMigrationCheckpoint(ctx, {
      runId,
      operation: ASSIGNMENT_OPERATIONS.assignments,
      previous,
      ...(lastRow === undefined
        ? {}
        : { lastLegacyKey: lastRow.legacyId }),
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    await writeMigrationBatchAudit(ctx, {
      runId,
      domain: DOMAIN,
      operation: ASSIGNMENT_OPERATIONS.assignments,
      processedThisBatch: batch.length,
      insertedThisBatch,
      reusedThisBatch,
      completed,
    });
    return migrationCheckpointResult(checkpoint);
  },
});

export const transformAssignmentAudioMessagesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_OPERATIONS.audioMessages,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.assignments,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_OPERATIONS.audioMessages,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
          "The assignment audio checkpoint cursor is invalid.",
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertAssignmentAudioMessage(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.audioMessages,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: String(lastRow.legacyId) }),
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      await writeMigrationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: ASSIGNMENT_OPERATIONS.audioMessages,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const transformSyllabusEntriesBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_OPERATIONS.syllabusEntries,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.assignments,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_OPERATIONS.syllabusEntries,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertSyllabusEntry(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.syllabusEntries,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      await writeMigrationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: ASSIGNMENT_OPERATIONS.syllabusEntries,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const transformAssignmentPointLinksBatch =
  internalMigrationMutation({
    args: { batchSize: v.number() },
    returns: checkpointResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        ASSIGNMENT_OPERATIONS.pointLinks,
      );
      requireMigrationBatchSize(args.batchSize);
      const runId = ctx.systemState.cutoverRunId;
      await getActiveDomainRun(ctx, { runId, domain: DOMAIN });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.assignments,
      });
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: GAME_OPERATIONS.points,
      });
      const previous = await getMigrationCheckpoint(
        ctx,
        runId,
        ASSIGNMENT_OPERATIONS.pointLinks,
      );
      if (previous?.status === "completed") {
        return migrationCheckpointResult(previous);
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
      let insertedThisBatch = 0;
      let reusedThisBatch = 0;
      for (const row of batch) {
        const outcome = await upsertAssignmentPointLink(ctx, row);
        if (outcome === "inserted") {
          insertedThisBatch += 1;
        } else {
          reusedThisBatch += 1;
        }
      }
      const lastRow = batch.at(-1);
      const checkpoint = await saveMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.pointLinks,
        previous,
        ...(lastRow === undefined
          ? {}
          : { lastLegacyKey: lastRow.legacyId }),
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      await writeMigrationBatchAudit(ctx, {
        runId,
        domain: DOMAIN,
        operation: ASSIGNMENT_OPERATIONS.pointLinks,
        processedThisBatch: batch.length,
        insertedThisBatch,
        reusedThisBatch,
        completed,
      });
      return migrationCheckpointResult(checkpoint);
    },
  });

export const finishAssignmentRun = internalMigrationMutation({
  args: {},
  returns: v.object({
    runId: v.string(),
    status: v.literal("transformed"),
    assignments: v.number(),
    audioMessages: v.number(),
    syllabusEntries: v.number(),
    pointLinks: v.number(),
  }),
  handler: async (ctx) => {
    requireMigrationOperation(
      ctx.migrationOperationId,
      ASSIGNMENT_OPERATIONS.finish,
    );
    const runId = ctx.systemState.cutoverRunId;
    const { domainRun } = await getActiveDomainRun(ctx, {
      runId,
      domain: DOMAIN,
    });
    const assignments = await requireCompletedMigrationCheckpoint(
      ctx,
      {
        runId,
        operation: ASSIGNMENT_OPERATIONS.assignments,
      },
    );
    const audioMessages =
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.audioMessages,
      });
    const syllabusEntries =
      await requireCompletedMigrationCheckpoint(ctx, {
        runId,
        operation: ASSIGNMENT_OPERATIONS.syllabusEntries,
      });
    const pointLinks = await requireCompletedMigrationCheckpoint(
      ctx,
      {
        runId,
        operation: ASSIGNMENT_OPERATIONS.pointLinks,
      },
    );
    const actualCounts = {
      assignments: assignments.processedCount,
      audioMessages: audioMessages.processedCount,
      syllabusEntries: syllabusEntries.processedCount,
      pointLinks: pointLinks.processedCount,
    };
    if (
      Object.entries(actualCounts).some(
        ([key, value]) => domainRun.expectedCounts[key] !== value,
      )
    ) {
      domainError(
        "CONFLICT",
        "Assignment transform counts do not match source expectations.",
        { details: actualCounts },
      );
    }
    await ctx.db.patch("migrationDomainRuns", domainRun._id, {
      status: "transformed",
      updatedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "migration.assignments.transformed",
      targetType: "migrationDomainRun",
      targetId: domainRun._id,
      cutoverRunId: runId,
      metadata: actualCounts,
    });
    return {
      runId,
      status: "transformed" as const,
      ...actualCounts,
    };
  },
});
