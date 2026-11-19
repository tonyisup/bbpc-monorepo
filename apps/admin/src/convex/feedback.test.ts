import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  deleteConvexAdminFeedback,
  formatFeedbackCount,
  loadConvexAdminFeedback,
  loadConvexAdminFeedbackCounts,
  setConvexAdminFeedbackStatus,
} from "./feedback";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const feedback = {
  id: "feedback-1",
  category: "idea" as const,
  message: "Add a dark mode.",
  pagePath: "/syllabus",
  status: "new" as const,
  createdAt: 1_000,
  updatedAt: 1_000,
  submitter: { id: "user-1", name: "Listener", email: "l@example.test" },
};

describe("Convex admin feedback adapter", () => {
  test("validates the list and counts", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ items: [feedback], hasMore: false })
      .mockResolvedValueOnce({ new: 1, reviewed: 0, archived: 0, cap: 99 })
      .mockResolvedValueOnce({
        items: [{ ...feedback, category: "rant" }],
        hasMore: false,
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminFeedback(client, "new")).resolves.toEqual({
      items: [feedback],
      hasMore: false,
    });
    expect(query).toHaveBeenLastCalledWith(expect.anything(), {
      status: "new",
    });
    await expect(loadConvexAdminFeedbackCounts(client)).resolves.toEqual({
      new: 1,
      reviewed: 0,
      archived: 0,
      cap: 99,
    });
    await expect(loadConvexAdminFeedback(client, "new")).rejects.toThrow();
  });

  test("versions every feedback write", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({ ...feedback, status: "reviewed" })
      .mockResolvedValueOnce({ id: feedback.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await setConvexAdminFeedbackStatus(client, feedback.id, "reviewed");
    await deleteConvexAdminFeedback(client, feedback.id);

    expect(mutation.mock.calls.map((call) => call[1] as unknown)).toEqual([
      {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id: feedback.id,
        status: "reviewed",
      },
      { clientApiVersion: BBPC_CLIENT_API_VERSION, id: feedback.id },
    ]);
  });

  test("shows capped counts with a plus", () => {
    expect(formatFeedbackCount(0, 99)).toBe("0");
    expect(formatFeedbackCount(99, 99)).toBe("99");
    expect(formatFeedbackCount(100, 99)).toBe("99+");
  });
});
