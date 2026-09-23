import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { validateHttpUrl } from "../episodes/adminWriteModel.js";
import { domainError } from "../lib/errors.js";

export const MAX_ANNOUNCEMENT_MESSAGE_LENGTH = 280;
export const MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH = 40;
// Bounds the public read: every live announcement is among the unended ones.
export const MAX_UNENDED_ANNOUNCEMENTS = 20;
export const MAX_ADMIN_ANNOUNCEMENTS = 100;

export type AnnouncementSeverity = Doc<"announcements">["severity"];

export interface AnnouncementInput {
  message: string;
  severity: AnnouncementSeverity;
  startsAt: number;
  endsAt: number;
  linkUrl: string | null;
  linkLabel: string | null;
  dismissible: boolean;
}

export type AnnouncementFields = Pick<
  Doc<"announcements">,
  | "message"
  | "severity"
  | "startsAt"
  | "endsAt"
  | "linkUrl"
  | "linkLabel"
  | "dismissible"
>;

function validateInstant(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a valid timestamp.`,
    );
  }
  return value;
}

export function validateAnnouncementNow(value: number): number {
  return validateInstant(value, "The current time");
}

function validateMessage(value: string): string {
  const message = value.trim().normalize("NFKC");
  if (
    message.length < 1 ||
    message.length > MAX_ANNOUNCEMENT_MESSAGE_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `The message must contain 1 through ${String(MAX_ANNOUNCEMENT_MESSAGE_LENGTH)} characters.`,
    );
  }
  return message;
}

function validateLinkLabel(value: string): string {
  const label = value.trim().normalize("NFKC");
  if (
    label.length < 1 ||
    label.length > MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `The link label must contain 1 through ${String(MAX_ANNOUNCEMENT_LINK_LABEL_LENGTH)} characters.`,
    );
  }
  return label;
}

export function validateAnnouncementInput(
  input: AnnouncementInput,
): AnnouncementFields {
  const startsAt = validateInstant(input.startsAt, "The start time");
  const endsAt = validateInstant(input.endsAt, "The end time");
  if (endsAt <= startsAt) {
    domainError(
      "VALIDATION_FAILED",
      "The end time must be after the start time.",
    );
  }
  if (input.linkLabel !== null && input.linkUrl === null) {
    domainError(
      "VALIDATION_FAILED",
      "A link label requires a link URL.",
    );
  }
  return {
    message: validateMessage(input.message),
    severity: input.severity,
    startsAt,
    endsAt,
    ...(input.linkUrl === null
      ? {}
      : { linkUrl: validateHttpUrl(input.linkUrl, "The link URL") }),
    ...(input.linkLabel === null
      ? {}
      : { linkLabel: validateLinkLabel(input.linkLabel) }),
    dismissible: input.dismissible,
  };
}

export async function requireAnnouncement(
  ctx: Pick<QueryCtx, "db">,
  id: Id<"announcements">,
): Promise<Doc<"announcements">> {
  const announcement = await ctx.db.get("announcements", id);
  if (announcement === null) {
    domainError("NOT_FOUND", "The announcement was not found.");
  }
  return announcement;
}

export async function listUnendedAnnouncements(
  ctx: Pick<QueryCtx, "db">,
  now: number,
  limit: number,
): Promise<Array<Doc<"announcements">>> {
  return await ctx.db
    .query("announcements")
    .withIndex("by_endsAt", (index) => index.gt("endsAt", now))
    .take(limit);
}

export async function assertUnendedCapacity(
  ctx: Pick<QueryCtx, "db">,
  now: number,
  excludeId?: Id<"announcements">,
): Promise<void> {
  const unended = await listUnendedAnnouncements(
    ctx,
    now,
    MAX_UNENDED_ANNOUNCEMENTS + 1,
  );
  const others = unended.filter((row) => row._id !== excludeId);
  if (others.length >= MAX_UNENDED_ANNOUNCEMENTS) {
    domainError(
      "CONFLICT",
      "Too many live or scheduled announcements. End or delete one first.",
      { details: { limit: MAX_UNENDED_ANNOUNCEMENTS } },
    );
  }
}

const SEVERITY_RANK: Record<AnnouncementSeverity, number> = {
  warning: 0,
  info: 1,
};

// Warnings lead; within a severity, the most recently started comes first.
export function compareLiveAnnouncements(
  left: Doc<"announcements">,
  right: Doc<"announcements">,
): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    right.startsAt - left.startsAt
  );
}

export function toPublicAnnouncement(announcement: Doc<"announcements">) {
  return {
    id: announcement._id,
    message: announcement.message,
    severity: announcement.severity,
    startsAt: announcement.startsAt,
    endsAt: announcement.endsAt,
    linkUrl: announcement.linkUrl ?? null,
    linkLabel: announcement.linkLabel ?? null,
    dismissible: announcement.dismissible,
    updatedAt: announcement.updatedAt,
  };
}

export function toAdminAnnouncement(announcement: Doc<"announcements">) {
  return {
    ...toPublicAnnouncement(announcement),
    createdAt: announcement.createdAt,
  };
}
