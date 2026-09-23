import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

export const ANNOUNCEMENT_MESSAGE_MAX_LENGTH = 280;
export const ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH = 40;

const severitySchema = z.enum(["info", "warning"]);

const announcementSchema = z.object({
  id: z.string().min(1),
  message: z.string(),
  severity: severitySchema,
  startsAt: z.number(),
  endsAt: z.number(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  dismissible: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listReference = api.announcements.admin.list;

const createReference = api.announcements.admin.create;

const updateReference = api.announcements.admin.update;

const endNowReference = api.announcements.admin.endNow;

const removeReference = api.announcements.admin.remove;

export type ConvexAnnouncementSeverity = z.infer<typeof severitySchema>;
export type ConvexAdminAnnouncement = z.infer<typeof announcementSchema>;
export type ConvexAnnouncementStatus = "scheduled" | "live" | "ended";

export interface ConvexAdminAnnouncementInput {
  message: string;
  severity: ConvexAnnouncementSeverity;
  startsAt: number;
  endsAt: number;
  linkUrl: string | null;
  linkLabel: string | null;
  dismissible: boolean;
}

export function getAnnouncementStatus(
  announcement: Pick<ConvexAdminAnnouncement, "startsAt" | "endsAt">,
  now: number
): ConvexAnnouncementStatus {
  if (announcement.endsAt <= now) {
    return "ended";
  }
  return announcement.startsAt > now ? "scheduled" : "live";
}

export async function loadConvexAdminAnnouncements(
  client: ConvexReactClient
): Promise<ConvexAdminAnnouncement[]> {
  return z
    .array(announcementSchema)
    .parse(await client.query(listReference, {}));
}

export async function createConvexAdminAnnouncement(
  client: ConvexReactClient,
  input: ConvexAdminAnnouncementInput
): Promise<ConvexAdminAnnouncement> {
  return announcementSchema.parse(
    await client.mutation(createReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAdminAnnouncement(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminAnnouncementInput
): Promise<ConvexAdminAnnouncement> {
  return announcementSchema.parse(
    await client.mutation(updateReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("announcements", id),
      ...input,
    })
  );
}

export async function endConvexAdminAnnouncement(
  client: ConvexReactClient,
  id: string
): Promise<ConvexAdminAnnouncement> {
  return announcementSchema.parse(
    await client.mutation(endNowReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("announcements", id),
    })
  );
}

export async function deleteConvexAdminAnnouncement(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("announcements", id),
    })
  );
}
