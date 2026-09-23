import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  parseDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/dates";

import {
  createConvexAdminAnnouncement,
  deleteConvexAdminAnnouncement,
  endConvexAdminAnnouncement,
  getAnnouncementStatus,
  loadConvexAdminAnnouncements,
  updateConvexAdminAnnouncement,
} from "./announcements";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const announcement = {
  id: "announcement-1",
  message: "No episode this week.",
  severity: "info" as const,
  startsAt: 1_000,
  endsAt: 2_000,
  linkUrl: null,
  linkLabel: null,
  dismissible: true,
  createdAt: 500,
  updatedAt: 500,
};

const input = {
  message: announcement.message,
  severity: announcement.severity,
  startsAt: announcement.startsAt,
  endsAt: announcement.endsAt,
  linkUrl: "https://example.test",
  linkLabel: "Read more",
  dismissible: false,
};

describe("Convex admin announcement adapter", () => {
  test("validates the announcement list", async () => {
    const query = vi.fn().mockResolvedValueOnce([announcement]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminAnnouncements(client)).resolves.toEqual([
      announcement,
    ]);
    expect(query).toHaveBeenCalledWith(expect.anything(), {});

    query.mockResolvedValueOnce([{ ...announcement, severity: "critical" }]);
    await expect(loadConvexAdminAnnouncements(client)).rejects.toThrow();
  });

  test("versions every announcement write", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(announcement)
      .mockResolvedValueOnce(announcement)
      .mockResolvedValueOnce(announcement)
      .mockResolvedValueOnce({ id: announcement.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await createConvexAdminAnnouncement(client, input);
    await updateConvexAdminAnnouncement(client, announcement.id, input);
    await endConvexAdminAnnouncement(client, announcement.id);
    await deleteConvexAdminAnnouncement(client, announcement.id);

    expect(mutation.mock.calls.map((call) => call[1] as unknown)).toEqual([
      { clientApiVersion: BBPC_CLIENT_API_VERSION, ...input },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: announcement.id, ...input },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: announcement.id },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: announcement.id },
    ]);
  });

  test("derives status from the schedule", () => {
    expect(getAnnouncementStatus(announcement, 999)).toBe("scheduled");
    expect(getAnnouncementStatus(announcement, 1_000)).toBe("live");
    expect(getAnnouncementStatus(announcement, 1_999)).toBe("live");
    expect(getAnnouncementStatus(announcement, 2_000)).toBe("ended");
  });

  test("round-trips datetime-local values in the local time zone", () => {
    const value = new Date(2026, 8, 23, 7, 5).getTime();
    expect(toDateTimeLocalValue(value)).toBe("2026-09-23T07:05");
    expect(parseDateTimeLocalValue("2026-09-23T07:05")).toBe(value);
    expect(parseDateTimeLocalValue("")).toBeNull();
    expect(parseDateTimeLocalValue("2026-13-45T99:99")).toBeNull();
  });
});
