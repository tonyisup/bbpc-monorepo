import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  ADMIN_SIDE_EFFECT_PAGE_SIZE,
  loadConvexSideEffectPage,
  redriveConvexSideEffect,
} from "./sideEffects";

const intent = {
  id: "intent-1",
  operation: "uploadthing.deleteFile" as const,
  resourceType: "episodeAudioMessage" as const,
  resourceId: "audio-1",
  status: "terminal" as const,
  attemptCount: 5,
  nextAttemptAt: null,
  lastAttemptAt: 100,
  lastErrorCode: "provider_unavailable",
  completedAt: null,
  createdAt: 1,
  updatedAt: 101,
};

describe("Convex side-effect admin adapter", () => {
  test("loads a filtered native page without exposing provider data", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [intent],
      isDone: true,
      continueCursor: "",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexSideEffectPage(client, null, "terminal")
    ).resolves.toEqual({
      intents: [intent],
      isDone: true,
      continueCursor: "",
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      status: "terminal",
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_SIDE_EFFECT_PAGE_SIZE,
      },
    });
    expect(JSON.stringify(query.mock.results)).not.toContain("providerKey");
  });

  test("omits the optional filter and sends compare-and-swap redrive state", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: "",
    });
    const mutation = vi.fn().mockResolvedValue({
      ...intent,
      status: "pending",
      nextAttemptAt: 102,
      lastErrorCode: null,
      updatedAt: 102,
    });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await loadConvexSideEffectPage(client, "cursor-1");
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      paginationOpts: {
        cursor: "cursor-1",
        numItems: ADMIN_SIDE_EFFECT_PAGE_SIZE,
      },
    });
    await expect(
      redriveConvexSideEffect(client, intent)
    ).resolves.toMatchObject({
      id: intent.id,
      status: "pending",
    });
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      clientApiVersion: expect.any(String),
      id: intent.id,
      expectedStatus: "terminal",
      expectedUpdatedAt: 101,
    });
  });

  test("rejects malformed backend output", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        page: [{ ...intent, providerKey: "must-not-be-used", status: "bad" }],
        isDone: true,
        continueCursor: "",
      }),
    } as unknown as ConvexReactClient;

    await expect(
      loadConvexSideEffectPage(client, null)
    ).rejects.toThrow();
  });
});
