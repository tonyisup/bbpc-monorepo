import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { MAX_ASSIGNMENTS_PER_EPISODE } from "./limits.js";
import { hydrateAssignment } from "./readModel.js";
import { assignmentDetailValidator } from "./validators.js";
import {
  allocateAssignmentSlug,
  assertAssignmentUnreferenced,
  requireAssignment,
  requireAssignmentParents,
  validateAssignmentType,
  validateRequestedAssignmentSlug,
} from "./writeModel.js";

export const getById = adminQuery({
  args: { id: v.id("assignments") },
  returns: v.union(assignmentDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get("assignments", args.id);
    return assignment === null
      ? null
      : await hydrateAssignment(ctx, assignment);
  },
});

export const listPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(assignmentDetailValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("assignments")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((assignment) =>
          hydrateAssignment(ctx, assignment),
        ),
      ),
    };
  },
});

export const listForEpisode = adminQuery({
  args: { episodeId: v.id("episodes") },
  returns: v.array(assignmentDetailValidator),
  handler: async (ctx, args) => {
    const episode = await ctx.db.get("episodes", args.episodeId);
    if (episode === null) {
      domainError("NOT_FOUND", "The episode is unavailable.");
    }
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", episode._id),
      )
      .take(MAX_ASSIGNMENTS_PER_EPISODE + 1);
    if (assignments.length > MAX_ASSIGNMENTS_PER_EPISODE) {
      domainError(
        "CONFLICT",
        "Episode assignments exceed the administrator read limit.",
        {
          details: {
            limit: MAX_ASSIGNMENTS_PER_EPISODE,
            relationship: "assignments",
          },
        },
      );
    }
    return await Promise.all(
      assignments.map((assignment) =>
        hydrateAssignment(ctx, assignment),
      ),
    );
  },
});

export const create = adminMutation({
  args: {
    userId: v.id("users"),
    movieId: v.id("movies"),
    episodeId: v.id("episodes"),
    type: v.string(),
  },
  returns: assignmentDetailValidator,
  handler: async (ctx, args) => {
    const type = validateAssignmentType(args.type);
    const parents = await requireAssignmentParents(ctx, args);
    const slug = await allocateAssignmentSlug(ctx, {
      ...parents,
      assignmentType: type,
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId: parents.user._id,
      movieId: parents.movie._id,
      episodeId: parents.episode._id,
      type,
      playable: false,
      ...slug,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.created",
      targetType: "assignment",
      targetId: assignmentId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { type },
    });
    return await hydrateAssignment(
      ctx,
      await requireAssignment(ctx, assignmentId),
    );
  },
});

export const updateSlug = adminMutation({
  args: {
    id: v.id("assignments"),
    slug: v.optional(v.string()),
  },
  returns: assignmentDetailValidator,
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(ctx, args.id);
    if (args.slug === undefined) {
      return await hydrateAssignment(ctx, assignment);
    }
    const parents = await requireAssignmentParents(ctx, assignment);
    const slug =
      args.slug.length === 0
        ? await allocateAssignmentSlug(ctx, {
            ...parents,
            assignmentType: validateAssignmentType(assignment.type),
            excludeId: assignment._id,
          })
        : await validateRequestedAssignmentSlug(
            ctx,
            args.slug,
            assignment._id,
          );
    await ctx.db.patch("assignments", assignment._id, slug);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.slugUpdated",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { regenerated: args.slug.length === 0 },
    });
    return await hydrateAssignment(ctx, { ...assignment, ...slug });
  },
});

export const setType = adminMutation({
  args: {
    id: v.id("assignments"),
    type: v.string(),
  },
  returns: assignmentDetailValidator,
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(ctx, args.id);
    const type = validateAssignmentType(args.type);
    if (assignment.type === type) {
      return await hydrateAssignment(ctx, assignment);
    }
    await ctx.db.patch("assignments", assignment._id, { type });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.typeUpdated",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { type },
    });
    return await hydrateAssignment(ctx, { ...assignment, type });
  },
});

export const removeIfUnreferenced = adminMutation({
  args: { id: v.id("assignments") },
  returns: v.object({ id: v.id("assignments") }),
  handler: async (ctx, args) => {
    const assignment = await requireAssignment(ctx, args.id);
    await assertAssignmentUnreferenced(ctx, assignment._id);
    await ctx.db.delete("assignments", assignment._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "assignments.admin.deleted",
      targetType: "assignment",
      targetId: assignment._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: assignment._id };
  },
});
