import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  allocateAssignmentSlug,
  requireAssignment,
  requireAssignmentParents,
  validateAssignmentType,
} from "../assignments/writeModel.js";
import { validateEpisodeNumber } from "../episodes/adminWriteModel.js";
import {
  hydrateAdminSyllabusEntry,
  listCanonicalSyllabusEntries,
  partitionSyllabusEntries,
} from "./readModel.js";
import {
  MAX_SYLLABUS_ENTRIES_PER_USER,
  validateSyllabusAdminPageSize,
} from "./limits.js";
import {
  syllabusAdminEntryValidator,
  syllabusEntrySnapshotValidator,
} from "./validators.js";
import {
  applyDenseSyllabusOrder,
  normalizeUserSyllabus,
  requireSyllabusEntry,
} from "./writeModel.js";

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function assertSyllabusSnapshot(
  entry: Doc<"syllabusEntries">,
  expected: {
    userId: Id<"users">;
    movieId: Id<"movies">;
    order: number;
    createdAt: number;
    notes: string | null;
    assignmentId: Id<"assignments"> | null;
  } | undefined,
): void {
  if (
    expected !== undefined &&
    (entry.userId !== expected.userId ||
      entry.movieId !== expected.movieId ||
      entry.order !== expected.order ||
      entry.createdAt !== expected.createdAt ||
      nullable(entry.notes) !== expected.notes ||
      nullable(entry.assignmentId) !== expected.assignmentId)
  ) {
    domainError(
      "CONFLICT",
      "The syllabus entry changed after it was loaded.",
    );
  }
}

async function requireEpisodeByNumber(
  ctx: Parameters<typeof requireSyllabusEntry>[0],
  number: number,
): Promise<Doc<"episodes">> {
  const validatedNumber = validateEpisodeNumber(number);
  const episode = await ctx.db
    .query("episodes")
    .withIndex("by_number", (index) =>
      index.eq("number", validatedNumber),
    )
    .first();
  if (episode === null) {
    domainError("NOT_FOUND", "The episode is unavailable.");
  }
  return episode;
}

export const getById = adminQuery({
  args: { id: v.id("syllabusEntries") },
  returns: v.union(syllabusAdminEntryValidator, v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get("syllabusEntries", args.id);
    return entry === null
      ? null
      : await hydrateAdminSyllabusEntry(ctx, entry);
  },
});

export const listPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(syllabusAdminEntryValidator),
  handler: async (ctx, args) => {
    validateSyllabusAdminPageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("syllabusEntries")
      .withIndex("by_createdAt")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((entry) =>
          hydrateAdminSyllabusEntry(ctx, entry),
        ),
      ),
    };
  },
});

export const listForUser = adminQuery({
  args: { userId: v.id("users") },
  returns: v.array(syllabusAdminEntryValidator),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (user === null) {
      domainError("NOT_FOUND", "The syllabus user is unavailable.");
    }
    const entries = await listCanonicalSyllabusEntries(
      ctx,
      user._id,
    );
    return await Promise.all(
      entries.map((entry) =>
        hydrateAdminSyllabusEntry(ctx, entry),
      ),
    );
  },
});

export const assignEpisode = adminMutation({
  args: {
    syllabusId: v.id("syllabusEntries"),
    expected: v.optional(syllabusEntrySnapshotValidator),
    episodeNumber: v.number(),
    assignmentType: v.string(),
  },
  returns: syllabusAdminEntryValidator,
  handler: async (ctx, args) => {
    const type = validateAssignmentType(args.assignmentType);
    const entry = await requireSyllabusEntry(ctx, args.syllabusId);
    assertSyllabusSnapshot(entry, args.expected);
    const episode = await requireEpisodeByNumber(
      ctx,
      args.episodeNumber,
    );
    const parents = await requireAssignmentParents(ctx, {
      userId: entry.userId,
      movieId: entry.movieId,
      episodeId: episode._id,
    });
    let assignment = await ctx.db
      .query("assignments")
      .withIndex("by_userId_and_movieId_and_episodeId", (index) =>
        index
          .eq("userId", entry.userId)
          .eq("movieId", entry.movieId)
          .eq("episodeId", episode._id),
      )
      .order("asc")
      .first();
    let created = false;
    let repairedSlug = false;
    if (assignment === null) {
      const slug = await allocateAssignmentSlug(ctx, {
        ...parents,
        assignmentType: type,
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: entry.userId,
        movieId: entry.movieId,
        episodeId: episode._id,
        type,
        playable: false,
        ...slug,
      });
      assignment = await requireAssignment(ctx, assignmentId);
      created = true;
    } else if (
      assignment.slug === undefined ||
      assignment.normalizedSlug === undefined
    ) {
      const slug = await allocateAssignmentSlug(ctx, {
        ...parents,
        assignmentType: type,
        excludeId: assignment._id,
      });
      await ctx.db.patch("assignments", assignment._id, slug);
      assignment = { ...assignment, ...slug };
      repairedSlug = true;
    }
    await ctx.db.patch("syllabusEntries", entry._id, {
      assignmentId: assignment._id,
    });
    await normalizeUserSyllabus(ctx, entry.userId);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.admin.episodeAssigned",
      targetType: "syllabusEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        assignmentCreated: created,
        episodeNumber: episode.number,
        repairedSlug,
      },
    });
    return await hydrateAdminSyllabusEntry(ctx, {
      ...entry,
      assignmentId: assignment._id,
    });
  },
});

export const unlinkEpisode = adminMutation({
  args: {
    syllabusId: v.id("syllabusEntries"),
    expected: v.optional(syllabusEntrySnapshotValidator),
  },
  returns: syllabusAdminEntryValidator,
  handler: async (ctx, args) => {
    const entry = await requireSyllabusEntry(ctx, args.syllabusId);
    assertSyllabusSnapshot(entry, args.expected);
    if (entry.assignmentId !== undefined) {
      await ctx.db.patch("syllabusEntries", entry._id, {
        assignmentId: undefined,
      });
      await normalizeUserSyllabus(ctx, entry.userId);
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "syllabus.admin.episodeUnlinked",
        targetType: "syllabusEntry",
        targetId: entry._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
      });
    }
    return await hydrateAdminSyllabusEntry(
      ctx,
      await requireSyllabusEntry(ctx, entry._id),
    );
  },
});

export const removeEntry = adminMutation({
  args: {
    id: v.id("syllabusEntries"),
    expected: v.optional(syllabusEntrySnapshotValidator),
  },
  returns: v.object({ id: v.id("syllabusEntries") }),
  handler: async (ctx, args) => {
    const entry = await requireSyllabusEntry(ctx, args.id);
    assertSyllabusSnapshot(entry, args.expected);
    await ctx.db.delete("syllabusEntries", entry._id);
    await normalizeUserSyllabus(ctx, entry.userId);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.admin.deleted",
      targetType: "syllabusEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: entry._id };
  },
});

export const reorderPendingForUser = adminMutation({
  args: {
    userId: v.id("users"),
    items: v.array(
      v.object({
        id: v.id("syllabusEntries"),
        expectedOrder: v.number(),
      }),
    ),
  },
  returns: v.array(syllabusAdminEntryValidator),
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (user === null) {
      domainError("NOT_FOUND", "The syllabus user is unavailable.");
    }
    if (args.items.length > MAX_SYLLABUS_ENTRIES_PER_USER) {
      domainError(
        "VALIDATION_FAILED",
        "The syllabus reorder exceeds its supported limit.",
        { details: { limit: MAX_SYLLABUS_ENTRIES_PER_USER } },
      );
    }
    const current = await listCanonicalSyllabusEntries(ctx, user._id);
    const { pending, assigned } = partitionSyllabusEntries(current);
    const requestedIds = new Set(args.items.map((item) => item.id));
    if (
      requestedIds.size !== args.items.length ||
      args.items.length !== pending.length ||
      pending.some((entry) => !requestedIds.has(entry._id))
    ) {
      domainError(
        "CONFLICT",
        "Syllabus reorder must include every pending entry exactly once.",
      );
    }
    const pendingById = new Map(
      pending.map((entry) => [entry._id, entry]),
    );
    const ordered = args.items.map((item) => {
      const entry = pendingById.get(item.id);
      if (entry?.order !== item.expectedOrder) {
        domainError(
          "CONFLICT",
          "The syllabus order changed after it was loaded.",
        );
      }
      return entry;
    });
    const normalized = await applyDenseSyllabusOrder(ctx, [
      ...ordered,
      ...assigned,
    ]);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.admin.reordered",
      targetType: "user",
      targetId: user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { pendingCount: ordered.length },
    });
    return await Promise.all(
      normalized.map((entry) =>
        hydrateAdminSyllabusEntry(ctx, entry),
      ),
    );
  },
});
