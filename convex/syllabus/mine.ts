import { v } from "convex/values";

import {
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  hydrateSyllabusEntry,
  listCanonicalSyllabusEntries,
  partitionSyllabusEntries,
} from "./readModel.js";
import {
  syllabusEntryValidator,
  syllabusPositionValidator,
} from "./validators.js";
import {
  applyDenseSyllabusOrder,
  insertSyllabusEntry,
  normalizeUserSyllabus,
  requireOwnedSyllabusEntry,
  requireSyllabusEntry,
  validateSyllabusNotes,
} from "./writeModel.js";

export const list = authenticatedQuery({
  args: {},
  returns: v.array(syllabusEntryValidator),
  handler: async (ctx) => {
    const entries = await listCanonicalSyllabusEntries(
      ctx,
      ctx.actor.user._id,
    );
    return await Promise.all(
      entries.map((entry) => hydrateSyllabusEntry(ctx, entry)),
    );
  },
});

export const add = authenticatedMutation({
  args: {
    movieId: v.id("movies"),
    position: v.optional(syllabusPositionValidator),
  },
  returns: syllabusEntryValidator,
  handler: async (ctx, args) => {
    const entry = await insertSyllabusEntry(ctx, {
      userId: ctx.actor.user._id,
      movieId: args.movieId,
      position: args.position ?? "END",
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.owner.created",
      targetType: "syllabusEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { position: args.position ?? "END" },
    });
    return await hydrateSyllabusEntry(ctx, entry);
  },
});

export const remove = authenticatedMutation({
  args: { id: v.id("syllabusEntries") },
  returns: v.object({ id: v.id("syllabusEntries") }),
  handler: async (ctx, args) => {
    const entry = await requireSyllabusEntry(ctx, args.id);
    requireOwnedSyllabusEntry(entry, ctx.actor.user._id);
    await ctx.db.delete("syllabusEntries", entry._id);
    await normalizeUserSyllabus(ctx, ctx.actor.user._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.owner.deleted",
      targetType: "syllabusEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: entry._id };
  },
});

export const reorderPending = authenticatedMutation({
  args: {
    orderedPendingIds: v.array(v.id("syllabusEntries")),
  },
  returns: v.object({ success: v.literal(true) }),
  handler: async (ctx, args) => {
    const entries = await listCanonicalSyllabusEntries(
      ctx,
      ctx.actor.user._id,
    );
    const { pending, assigned } =
      partitionSyllabusEntries(entries);
    const supplied = new Set(args.orderedPendingIds);
    if (
      supplied.size !== args.orderedPendingIds.length ||
      supplied.size !== pending.length ||
      pending.some((entry) => !supplied.has(entry._id))
    ) {
      domainError(
        "CONFLICT",
        "Syllabus reorder must include every pending entry exactly once.",
      );
    }
    const pendingById = new Map(
      pending.map((entry) => [entry._id, entry]),
    );
    const ordered = args.orderedPendingIds.map((id) => {
      const entry = pendingById.get(id);
      if (entry === undefined) {
        domainError(
          "CONFLICT",
          "Syllabus reorder contains an unavailable entry.",
        );
      }
      return entry;
    });
    await applyDenseSyllabusOrder(ctx, [...ordered, ...assigned]);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.owner.reordered",
      targetType: "syllabus",
      targetId: ctx.actor.user._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { pendingCount: pending.length },
    });
    return { success: true as const };
  },
});

export const updateNotes = authenticatedMutation({
  args: {
    id: v.id("syllabusEntries"),
    notes: v.union(v.string(), v.null()),
  },
  returns: syllabusEntryValidator,
  handler: async (ctx, args) => {
    const entry = await requireSyllabusEntry(ctx, args.id);
    requireOwnedSyllabusEntry(entry, ctx.actor.user._id);
    const notes = validateSyllabusNotes(args.notes);
    await ctx.db.patch("syllabusEntries", entry._id, { notes });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "syllabus.owner.notesUpdated",
      targetType: "syllabusEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { hasNotes: notes !== undefined },
    });
    return await hydrateSyllabusEntry(
      ctx,
      await requireSyllabusEntry(ctx, entry._id),
    );
  },
});
