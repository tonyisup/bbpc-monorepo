import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import {
  adminMutation,
  adminQuery,
  anonymousQuery,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import type { ApplicationActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_ASSIGNMENTS_FOR_GAMBLING_READ,
  MAX_GAMBLING_ENTRIES_PER_READ,
  MAX_GAMBLING_TYPES,
  validateGamblingPageSize,
} from "./limits.js";
import {
  assertGamblingReadLimit,
  hydrateGamblingEntries,
  hydrateGamblingEntry,
  requireGamblingEntry,
  requireGamblingType,
  toGamblingType,
} from "./gamblingReadModel.js";
import {
  assertGamblingBudget,
  assertGamblingTypeUnreferenced,
  assertUniqueGamblingTypeLookup,
  findCanonicalGamblingEntry,
  transitionGamblingStatus,
  updateResolvedGamblingAward,
  validateGamblingAwardPoint,
  validateGamblingCreatedAt,
  validateGamblingDescription,
  validateGamblingLookupId,
  validateGamblingMultiplier,
  validateGamblingNotes,
  validateGamblingParents,
  validateGamblingPoints,
  validateGamblingTitle,
} from "./gamblingWriteModel.js";
import {
  requirePointAssignment,
  requirePointUser,
  resolvePointSeason,
} from "./pointWriteModel.js";
import {
  assignmentGamblingGroupValidator,
  gamblingEditableSnapshotValidator,
  gamblingEntryValidator,
  gamblingStatusValidator,
  gamblingTypeValidator,
  pointSeasonSelectorValidator,
  pointSeasonTargetValidator,
} from "./validators.js";

function validateAssignmentIds(assignmentIds: Array<Id<"assignments">>): void {
  if (
    assignmentIds.length < 1 ||
    assignmentIds.length > MAX_ASSIGNMENTS_FOR_GAMBLING_READ ||
    new Set(assignmentIds).size !== assignmentIds.length
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Assignment IDs must contain 1 through ${String(MAX_ASSIGNMENTS_FOR_GAMBLING_READ)} distinct values.`,
    );
  }
}

async function readEntriesForAssignmentUser(
  ctx: Parameters<typeof hydrateGamblingEntries>[0],
  assignmentId: Id<"assignments">,
  userId: Id<"users">,
): Promise<Array<Doc<"gamblingEntries">>> {
  const entries = await ctx.db
    .query("gamblingEntries")
    .withIndex("by_userId_and_assignmentId", (index) =>
      index.eq("userId", userId).eq("assignmentId", assignmentId),
    )
    .take(MAX_GAMBLING_ENTRIES_PER_READ + 1);
  assertGamblingReadLimit(entries, "Assignment wagers");
  return entries;
}

async function resolveReadType(
  ctx: Parameters<typeof requireGamblingType>[0],
  id: Id<"gamblingTypes"> | undefined,
): Promise<Doc<"gamblingTypes">> {
  if (id !== undefined) {
    return await requireGamblingType(ctx, id);
  }
  const gamblingType = await ctx.db
    .query("gamblingTypes")
    .withIndex("by_normalizedLookupId", (index) =>
      index.eq("normalizedLookupId", "default"),
    )
    .unique();
  if (gamblingType === null) {
    domainError("NOT_FOUND", "The default gambling type is unavailable.");
  }
  return gamblingType;
}

async function resolveSelectedSeasonId(
  ctx: Parameters<typeof resolvePointSeason>[0],
  selector:
    | { kind: "all" }
    | { kind: "current"; today: string }
    | { kind: "season"; seasonId: Id<"seasons"> },
): Promise<Id<"seasons"> | null> {
  return selector.kind === "all"
    ? null
    : (await resolvePointSeason(ctx, selector))._id;
}

export const listActiveTypes = anonymousQuery({
  args: {},
  returns: v.array(gamblingTypeValidator),
  handler: async (ctx) => {
    const types = await ctx.db
      .query("gamblingTypes")
      .withIndex("by_isActive_and_createdAt", (index) =>
        index.eq("isActive", true),
      )
      .order("desc")
      .take(MAX_GAMBLING_TYPES + 1);
    if (types.length > MAX_GAMBLING_TYPES) {
      domainError(
        "CONFLICT",
        "The active gambling type catalog exceeds its read limit.",
        { details: { limit: MAX_GAMBLING_TYPES } },
      );
    }
    return types.map(toGamblingType);
  },
});

export const mineForAssignment = authenticatedQuery({
  args: { assignmentId: v.id("assignments") },
  returns: v.array(gamblingEntryValidator),
  handler: async (ctx, args) => {
    await requirePointAssignment(ctx, args.assignmentId);
    return await hydrateGamblingEntries(
      ctx,
      await readEntriesForAssignmentUser(
        ctx,
        args.assignmentId,
        ctx.actor.user._id,
      ),
    );
  },
});

export const hasWonForEpisode = authenticatedQuery({
  args: { episodeId: v.id("episodes") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const episode = await ctx.db.get("episodes", args.episodeId);
    if (episode === null) {
      domainError("NOT_FOUND", "The episode is unavailable.");
    }
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", args.episodeId),
      )
      .take(MAX_ASSIGNMENTS_FOR_GAMBLING_READ + 1);
    if (assignments.length > MAX_ASSIGNMENTS_FOR_GAMBLING_READ) {
      domainError(
        "CONFLICT",
        "Episode assignments exceed the supported gambling read limit.",
        {
          details: {
            limit: MAX_ASSIGNMENTS_FOR_GAMBLING_READ,
          },
        },
      );
    }
    for (const assignment of assignments) {
      const entries = await readEntriesForAssignmentUser(
        ctx,
        assignment._id,
        ctx.actor.user._id,
      );
      if (entries.some((entry) => entry.status === "won")) {
        return true;
      }
    }
    return false;
  },
});

export const mineForAssignments = authenticatedQuery({
  args: { assignmentIds: v.array(v.id("assignments")) },
  returns: v.array(assignmentGamblingGroupValidator),
  handler: async (ctx, args) => {
    validateAssignmentIds(args.assignmentIds);
    const groups = [];
    for (const assignmentId of args.assignmentIds) {
      await requirePointAssignment(ctx, assignmentId);
      groups.push({
        assignmentId,
        entries: await hydrateGamblingEntries(
          ctx,
          await readEntriesForAssignmentUser(
            ctx,
            assignmentId,
            ctx.actor.user._id,
          ),
        ),
      });
    }
    return groups;
  },
});

export const mineForType = authenticatedQuery({
  args: { gamblingTypeId: v.optional(v.id("gamblingTypes")) },
  returns: v.array(gamblingEntryValidator),
  handler: async (ctx, args) => {
    const gamblingType = await resolveReadType(ctx, args.gamblingTypeId);
    const entries = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_userId_and_gamblingTypeId", (index) =>
        index
          .eq("userId", ctx.actor.user._id)
          .eq("gamblingTypeId", gamblingType._id),
      )
      .take(MAX_GAMBLING_ENTRIES_PER_READ + 1);
    assertGamblingReadLimit(entries, "User gambling-type entries");
    return await hydrateGamblingEntries(ctx, entries);
  },
});

export const mineForActiveTypes = authenticatedQuery({
  args: {},
  returns: v.array(gamblingEntryValidator),
  handler: async (ctx) => {
    const entries = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_userId", (index) => index.eq("userId", ctx.actor.user._id))
      .take(MAX_GAMBLING_ENTRIES_PER_READ + 1);
    assertGamblingReadLimit(entries, "User gambling entries");
    const activeEntries: Array<Doc<"gamblingEntries">> = [];
    for (const entry of entries) {
      const gamblingType = await requireGamblingType(ctx, entry.gamblingTypeId);
      if (gamblingType.isActive) {
        activeEntries.push(entry);
      }
    }
    return await hydrateGamblingEntries(ctx, activeEntries);
  },
});

export const submit = authenticatedMutation({
  args: {
    gamblingTypeId: v.optional(v.id("gamblingTypes")),
    points: v.number(),
    assignmentId: v.optional(v.id("assignments")),
    targetUserId: v.optional(v.id("users")),
    today: v.string(),
    createdAt: v.optional(v.number()),
  },
  returns: gamblingEntryValidator,
  handler: async (ctx, args) => {
    const points = validateGamblingPoints(args.points);
    const { season, gamblingType } = await validateGamblingParents(ctx, {
      userId: ctx.actor.user._id,
      season: { kind: "current", today: args.today },
      gamblingTypeId: args.gamblingTypeId,
      assignmentId: args.assignmentId,
      targetUserId: args.targetUserId,
    });
    const existing = await findCanonicalGamblingEntry(ctx, {
      userId: ctx.actor.user._id,
      seasonId: season._id,
      gamblingTypeId: gamblingType._id,
      assignmentId: args.assignmentId,
      targetUserId: args.targetUserId,
    });
    if (existing !== null && existing.status !== "pending") {
      domainError("CONFLICT", "Only a pending wager can be updated.", {
        details: { reason: "WAGER_LOCKED" },
      });
    }
    await assertGamblingBudget(ctx, {
      userId: ctx.actor.user._id,
      seasonId: season._id,
      points,
      ...(existing === null ? {} : { excludeEntryId: existing._id }),
    });
    let entry: Doc<"gamblingEntries">;
    if (existing === null) {
      const id = await ctx.db.insert("gamblingEntries", {
        userId: ctx.actor.user._id,
        points,
        createdAt: validateGamblingCreatedAt(args.createdAt ?? Date.now()),
        seasonId: season._id,
        gamblingTypeId: gamblingType._id,
        status: "pending",
        ...(args.assignmentId === undefined
          ? {}
          : { assignmentId: args.assignmentId }),
        ...(args.targetUserId === undefined
          ? {}
          : { targetUserId: args.targetUserId }),
      });
      entry = await requireGamblingEntry(ctx, id);
    } else {
      await ctx.db.patch("gamblingEntries", existing._id, { points });
      entry = await requireGamblingEntry(ctx, existing._id);
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action:
        existing === null
          ? "games.member.gamblingEntryCreated"
          : "games.member.gamblingEntryUpdated",
      targetType: "gamblingEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGamblingEntry(ctx, entry);
  },
});

export const listTypes = adminQuery({
  args: {},
  returns: v.array(gamblingTypeValidator),
  handler: async (ctx) => {
    const types = await ctx.db
      .query("gamblingTypes")
      .withIndex("by_createdAt")
      .order("desc")
      .take(MAX_GAMBLING_TYPES + 1);
    if (types.length > MAX_GAMBLING_TYPES) {
      domainError(
        "CONFLICT",
        "The gambling type catalog exceeds its read limit.",
        { details: { limit: MAX_GAMBLING_TYPES } },
      );
    }
    return types.map(toGamblingType);
  },
});

export const getTypeById = adminQuery({
  args: { id: v.id("gamblingTypes") },
  returns: v.union(gamblingTypeValidator, v.null()),
  handler: async (ctx, args) => {
    const gamblingType = await ctx.db.get("gamblingTypes", args.id);
    return gamblingType === null ? null : toGamblingType(gamblingType);
  },
});

export const createType = adminMutation({
  args: {
    title: v.string(),
    lookupId: v.string(),
    description: v.optional(v.string()),
    multiplier: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  },
  returns: gamblingTypeValidator,
  handler: async (ctx, args) => {
    const lookup = validateGamblingLookupId(args.lookupId);
    const description =
      args.description === undefined
        ? undefined
        : validateGamblingDescription(args.description);
    await assertUniqueGamblingTypeLookup(ctx, lookup.normalizedLookupId);
    const id = await ctx.db.insert("gamblingTypes", {
      title: validateGamblingTitle(args.title),
      ...lookup,
      multiplier: validateGamblingMultiplier(args.multiplier ?? 1.5),
      isActive: args.isActive ?? true,
      createdAt: validateGamblingCreatedAt(args.createdAt ?? Date.now()),
      ...(description === undefined ? {} : { description }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamblingTypeCreated",
      targetType: "gamblingType",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toGamblingType(await requireGamblingType(ctx, id));
  },
});

export const updateType = adminMutation({
  args: {
    id: v.id("gamblingTypes"),
    title: v.optional(v.string()),
    lookupId: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    multiplier: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  returns: gamblingTypeValidator,
  handler: async (ctx, args) => {
    const gamblingType = await requireGamblingType(ctx, args.id);
    const patch: {
      title?: string;
      lookupId?: string;
      normalizedLookupId?: string;
      description?: string | undefined;
      multiplier?: number;
      isActive?: boolean;
    } = {};
    if (args.title !== undefined) {
      patch.title = validateGamblingTitle(args.title);
    }
    if (args.lookupId !== undefined) {
      const lookup = validateGamblingLookupId(args.lookupId);
      await assertUniqueGamblingTypeLookup(
        ctx,
        lookup.normalizedLookupId,
        gamblingType._id,
      );
      Object.assign(patch, lookup);
    }
    if (args.description !== undefined) {
      patch.description = validateGamblingDescription(args.description);
    }
    if (args.multiplier !== undefined) {
      patch.multiplier = validateGamblingMultiplier(args.multiplier);
    }
    if (args.isActive !== undefined) {
      patch.isActive = args.isActive;
    }
    const fieldCount = Object.keys(patch).length;
    if (fieldCount === 0) {
      return toGamblingType(gamblingType);
    }
    await ctx.db.patch("gamblingTypes", gamblingType._id, patch);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamblingTypeUpdated",
      targetType: "gamblingType",
      targetId: gamblingType._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { fieldCount },
    });
    return toGamblingType(await requireGamblingType(ctx, gamblingType._id));
  },
});

export const removeType = adminMutation({
  args: { id: v.id("gamblingTypes") },
  returns: v.object({ id: v.id("gamblingTypes") }),
  handler: async (ctx, args) => {
    const gamblingType = await requireGamblingType(ctx, args.id);
    await assertGamblingTypeUnreferenced(ctx, gamblingType._id);
    await ctx.db.delete("gamblingTypes", gamblingType._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamblingTypeDeleted",
      targetType: "gamblingType",
      targetId: gamblingType._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: gamblingType._id };
  },
});

export const getById = adminQuery({
  args: { id: v.id("gamblingEntries") },
  returns: v.union(gamblingEntryValidator, v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get("gamblingEntries", args.id);
    return entry === null ? null : await hydrateGamblingEntry(ctx, entry);
  },
});

export const listForUserPage = adminQuery({
  args: {
    userId: v.id("users"),
    season: pointSeasonSelectorValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(gamblingEntryValidator),
  handler: async (ctx, args) => {
    validateGamblingPageSize(args.paginationOpts.numItems);
    await requirePointUser(ctx, args.userId);
    const seasonId = await resolveSelectedSeasonId(ctx, args.season);
    const result =
      seasonId === null
        ? await ctx.db
            .query("gamblingEntries")
            .withIndex("by_userId_and_createdAt", (index) =>
              index.eq("userId", args.userId),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("gamblingEntries")
            .withIndex("by_userId_and_seasonId_and_createdAt", (index) =>
              index.eq("userId", args.userId).eq("seasonId", seasonId),
            )
            .order("desc")
            .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateGamblingEntries(ctx, result.page),
    };
  },
});

export const listForSeasonPage = adminQuery({
  args: {
    seasonId: v.id("seasons"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(gamblingEntryValidator),
  handler: async (ctx, args) => {
    validateGamblingPageSize(args.paginationOpts.numItems);
    await resolvePointSeason(ctx, {
      kind: "season",
      seasonId: args.seasonId,
    });
    const result = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_seasonId_and_createdAt", (index) =>
        index.eq("seasonId", args.seasonId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateGamblingEntries(ctx, result.page),
    };
  },
});

export const listForAssignment = adminQuery({
  args: { assignmentId: v.id("assignments") },
  returns: v.array(gamblingEntryValidator),
  handler: async (ctx, args) => {
    await requirePointAssignment(ctx, args.assignmentId);
    const entries = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_assignmentId_and_createdAt", (index) =>
        index.eq("assignmentId", args.assignmentId),
      )
      .order("desc")
      .take(MAX_GAMBLING_ENTRIES_PER_READ + 1);
    assertGamblingReadLimit(entries, "Assignment wagers");
    return await hydrateGamblingEntries(ctx, entries);
  },
});

export const listForTypePage = adminQuery({
  args: {
    gamblingTypeId: v.id("gamblingTypes"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(gamblingEntryValidator),
  handler: async (ctx, args) => {
    validateGamblingPageSize(args.paginationOpts.numItems);
    await requireGamblingType(ctx, args.gamblingTypeId);
    const result = await ctx.db
      .query("gamblingEntries")
      .withIndex("by_gamblingTypeId_and_createdAt", (index) =>
        index.eq("gamblingTypeId", args.gamblingTypeId),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await hydrateGamblingEntries(ctx, result.page),
    };
  },
});

export const create = adminMutation({
  args: {
    userId: v.id("users"),
    gamblingTypeId: v.optional(v.id("gamblingTypes")),
    points: v.number(),
    season: pointSeasonTargetValidator,
    assignmentId: v.optional(v.id("assignments")),
    targetUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  returns: gamblingEntryValidator,
  handler: async (ctx, args) => {
    const points = validateGamblingPoints(args.points);
    const { user, season, gamblingType } = await validateGamblingParents(ctx, {
      userId: args.userId,
      season: args.season,
      gamblingTypeId: args.gamblingTypeId,
      assignmentId: args.assignmentId,
      targetUserId: args.targetUserId,
    });
    const existing = await findCanonicalGamblingEntry(ctx, {
      userId: user._id,
      seasonId: season._id,
      gamblingTypeId: gamblingType._id,
      assignmentId: args.assignmentId,
      targetUserId: args.targetUserId,
    });
    if (existing !== null) {
      domainError("CONFLICT", "The canonical wager already exists.");
    }
    await assertGamblingBudget(ctx, {
      userId: user._id,
      seasonId: season._id,
      points,
    });
    const notes =
      args.notes === undefined ? undefined : validateGamblingNotes(args.notes);
    const id = await ctx.db.insert("gamblingEntries", {
      userId: user._id,
      points,
      createdAt: validateGamblingCreatedAt(args.createdAt ?? Date.now()),
      seasonId: season._id,
      gamblingTypeId: gamblingType._id,
      status: "pending",
      ...(args.assignmentId === undefined
        ? {}
        : { assignmentId: args.assignmentId }),
      ...(args.targetUserId === undefined
        ? {}
        : { targetUserId: args.targetUserId }),
      ...(notes === undefined ? {} : { notes }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamblingEntryCreated",
      targetType: "gamblingEntry",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGamblingEntry(ctx, await requireGamblingEntry(ctx, id));
  },
});

export const updatePoints = adminMutation({
  args: {
    id: v.id("gamblingEntries"),
    expected: v.optional(gamblingEditableSnapshotValidator),
    points: v.number(),
  },
  returns: gamblingEntryValidator,
  handler: async (ctx, args) => {
    const entry = await requireGamblingEntry(ctx, args.id);
    if (
      args.expected !== undefined &&
      (entry.points !== args.expected.points ||
        entry.status !== args.expected.status ||
        (entry.awardPointId ?? null) !==
          args.expected.awardPointId)
    ) {
      domainError(
        "CONFLICT",
        "The wager changed after it was loaded.",
      );
    }
    const points = validateGamblingPoints(args.points);
    if (entry.status === "pending" || entry.status === "locked") {
      if (entry.seasonId === undefined) {
        domainError(
          "VALIDATION_FAILED",
          "A season is required to update an active wager.",
        );
      }
      await assertGamblingBudget(ctx, {
        userId: entry.userId,
        seasonId: entry.seasonId,
        points,
        excludeEntryId: entry._id,
      });
    }
    await ctx.db.patch("gamblingEntries", entry._id, { points });
    const updated = await requireGamblingEntry(ctx, entry._id);
    await updateResolvedGamblingAward(ctx, updated);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamblingEntryPointsUpdated",
      targetType: "gamblingEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGamblingEntry(
      ctx,
      await requireGamblingEntry(ctx, entry._id),
    );
  },
});

export const setAwardPoint = adminMutation({
  args: {
    id: v.id("gamblingEntries"),
    pointId: v.union(v.id("points"), v.null()),
  },
  returns: gamblingEntryValidator,
  handler: async (ctx, args) => {
    const entry = await requireGamblingEntry(ctx, args.id);
    if (args.pointId !== null) {
      await validateGamblingAwardPoint(ctx, entry, args.pointId);
    }
    await ctx.db.patch("gamblingEntries", entry._id, {
      awardPointId: args.pointId ?? undefined,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action:
        args.pointId === null
          ? "games.admin.gamblingAwardCleared"
          : "games.admin.gamblingAwardSet",
      targetType: "gamblingEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateGamblingEntry(
      ctx,
      await requireGamblingEntry(ctx, entry._id),
    );
  },
});

async function updateEntryStatus(
  ctx: MutationCtx & {
    actor: ApplicationActor;
    systemState: Doc<"systemState">;
  },
  input: {
    id: Id<"gamblingEntries">;
    status: "pending" | "locked" | "won" | "lost" | "rejected";
    expectedStatus?: "pending" | "locked" | "won" | "lost" | "rejected";
    season?:
      | { kind: "current"; today: string }
      | { kind: "season"; seasonId: Id<"seasons"> };
    earnedAt?: number;
  },
) {
  const current = await requireGamblingEntry(ctx, input.id);
  if (
    input.expectedStatus !== undefined &&
    current.status !== input.expectedStatus
  ) {
    domainError(
      "CONFLICT",
      "The wager status changed after it was loaded.",
    );
  }
  const entry = await transitionGamblingStatus(ctx, {
    entry: current,
    status: input.status,
    ...(input.season === undefined ? {} : { season: input.season }),
    earnedAt: input.earnedAt ?? Date.now(),
  });
  await writeAuditEvent(ctx, {
    actor: ctx.actor,
    action: "games.admin.gamblingStatusUpdated",
    targetType: "gamblingEntry",
    targetId: entry._id,
    cutoverRunId: ctx.systemState.cutoverRunId,
    metadata: { status: input.status },
  });
  return await hydrateGamblingEntry(ctx, entry);
}

export const updateStatus = adminMutation({
  args: {
    id: v.id("gamblingEntries"),
    status: gamblingStatusValidator,
    expectedStatus: v.optional(gamblingStatusValidator),
    season: v.optional(pointSeasonTargetValidator),
    earnedAt: v.optional(v.number()),
  },
  returns: gamblingEntryValidator,
  handler: updateEntryStatus,
});

export const confirm = adminMutation({
  args: {
    id: v.id("gamblingEntries"),
    season: v.optional(pointSeasonTargetValidator),
    earnedAt: v.optional(v.number()),
  },
  returns: gamblingEntryValidator,
  handler: async (ctx, args) =>
    await updateEntryStatus(ctx, { ...args, status: "won" }),
});

export const reject = adminMutation({
  args: {
    id: v.id("gamblingEntries"),
    season: v.optional(pointSeasonTargetValidator),
    earnedAt: v.optional(v.number()),
  },
  returns: gamblingEntryValidator,
  handler: async (ctx, args) =>
    await updateEntryStatus(ctx, { ...args, status: "lost" }),
});

export const remove = adminMutation({
  args: { id: v.id("gamblingEntries") },
  returns: v.object({ id: v.id("gamblingEntries") }),
  handler: async (ctx, args) => {
    const entry = await requireGamblingEntry(ctx, args.id);
    if (entry.status !== "pending") {
      domainError("CONFLICT", "Only a pending gambling entry can be deleted.");
    }
    if (entry.awardPointId !== undefined) {
      domainError(
        "CONFLICT",
        "A pending gambling entry with an award point cannot be deleted.",
      );
    }
    await ctx.db.delete("gamblingEntries", entry._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.gamblingEntryDeleted",
      targetType: "gamblingEntry",
      targetId: entry._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: entry._id };
  },
});
