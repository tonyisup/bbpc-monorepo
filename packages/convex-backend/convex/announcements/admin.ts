import { v } from "convex/values";

import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  assertUnendedCapacity,
  MAX_ADMIN_ANNOUNCEMENTS,
  requireAnnouncement,
  toAdminAnnouncement,
  validateAnnouncementInput,
} from "./model.js";
import {
  adminAnnouncementValidator,
  announcementInputFields,
} from "./validators.js";

export const list = adminQuery({
  args: {},
  returns: v.array(adminAnnouncementValidator),
  handler: async (ctx) => {
    const announcements = await ctx.db
      .query("announcements")
      .withIndex("by_endsAt")
      .order("desc")
      .take(MAX_ADMIN_ANNOUNCEMENTS);
    return announcements.map(toAdminAnnouncement);
  },
});

export const create = adminMutation({
  args: announcementInputFields,
  returns: adminAnnouncementValidator,
  handler: async (ctx, args) => {
    const fields = validateAnnouncementInput(args);
    const now = Date.now();
    if (fields.endsAt <= now) {
      domainError(
        "VALIDATION_FAILED",
        "The end time must be in the future.",
      );
    }
    await assertUnendedCapacity(ctx, now);
    const id = await ctx.db.insert("announcements", {
      ...fields,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "announcements.admin.created",
      targetType: "announcement",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { severity: fields.severity },
    });
    return toAdminAnnouncement(await requireAnnouncement(ctx, id));
  },
});

export const update = adminMutation({
  args: { id: v.id("announcements"), ...announcementInputFields },
  returns: adminAnnouncementValidator,
  handler: async (ctx, { id, ...input }) => {
    const announcement = await requireAnnouncement(ctx, id);
    const fields = validateAnnouncementInput(input);
    const now = Date.now();
    const scheduleChanged =
      fields.startsAt !== announcement.startsAt ||
      fields.endsAt !== announcement.endsAt;
    if (scheduleChanged && fields.endsAt <= now) {
      domainError(
        "VALIDATION_FAILED",
        "The end time must be in the future.",
      );
    }
    if (fields.endsAt > now) {
      await assertUnendedCapacity(ctx, now, announcement._id);
    }
    await ctx.db.replace("announcements", announcement._id, {
      ...fields,
      createdAt: announcement.createdAt,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "announcements.admin.updated",
      targetType: "announcement",
      targetId: announcement._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { severity: fields.severity, scheduleChanged },
    });
    return toAdminAnnouncement(
      await requireAnnouncement(ctx, announcement._id),
    );
  },
});

// Ends a live or scheduled announcement immediately, keeping it for reuse.
export const endNow = adminMutation({
  args: { id: v.id("announcements") },
  returns: adminAnnouncementValidator,
  handler: async (ctx, args) => {
    const announcement = await requireAnnouncement(ctx, args.id);
    const now = Date.now();
    if (announcement.endsAt <= now) {
      return toAdminAnnouncement(announcement);
    }
    await ctx.db.patch("announcements", announcement._id, {
      startsAt: Math.min(announcement.startsAt, now - 1),
      endsAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "announcements.admin.ended",
      targetType: "announcement",
      targetId: announcement._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toAdminAnnouncement(
      await requireAnnouncement(ctx, announcement._id),
    );
  },
});

export const remove = adminMutation({
  args: { id: v.id("announcements") },
  returns: v.object({ id: v.id("announcements") }),
  handler: async (ctx, args) => {
    const announcement = await requireAnnouncement(ctx, args.id);
    await ctx.db.delete("announcements", announcement._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "announcements.admin.deleted",
      targetType: "announcement",
      targetId: announcement._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: announcement._id };
  },
});
