import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());

export const announcementSeverityValidator = v.union(
  v.literal("info"),
  v.literal("warning"),
);

export const announcementInputFields = {
  message: v.string(),
  severity: announcementSeverityValidator,
  startsAt: v.number(),
  endsAt: v.number(),
  linkUrl: nullableStringValidator,
  linkLabel: nullableStringValidator,
  dismissible: v.boolean(),
};

export const publicAnnouncementValidator = v.object({
  id: v.id("announcements"),
  message: v.string(),
  severity: announcementSeverityValidator,
  startsAt: v.number(),
  endsAt: v.number(),
  linkUrl: nullableStringValidator,
  linkLabel: nullableStringValidator,
  dismissible: v.boolean(),
  updatedAt: v.number(),
});

export const adminAnnouncementValidator = publicAnnouncementValidator.extend({
  createdAt: v.number(),
});
