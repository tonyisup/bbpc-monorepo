import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import {
  checkConvexQuotabungaDuplicate,
  loadConvexQuotabunga,
  submitConvexQuotabunga,
} from "@/convex/quotabunga";

const input = {
  episodeId: "episode-test",
  quoteText: "Hold on to ya",
  sourceTitle: "Heat",
};
const match = {
  episodeNumber: 142,
  episodeTitle: "Heat",
  episodeSlug: null,
  start: 10,
  excerpt: "hold on to ya",
};

describe("checkConvexQuotabungaDuplicate", () => {
  test("treats a backend without transcript matching as having none", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ possibleMatch: true })
      .mockResolvedValueOnce({ possibleMatch: false, transcriptMatches: [match] })
      .mockResolvedValueOnce({
        possibleMatch: false,
        transcriptMatches: [{ ...match, start: "soon" }],
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(checkConvexQuotabungaDuplicate(client, input)).resolves.toEqual({
      possibleMatch: true,
      transcriptMatches: [],
    });
    await expect(checkConvexQuotabungaDuplicate(client, input)).resolves.toEqual({
      possibleMatch: false,
      transcriptMatches: [match],
    });
    await expect(checkConvexQuotabungaDuplicate(client, input)).rejects.toThrow();
    expect(query).toHaveBeenCalledWith(expect.anything(), input);
  });
});

describe("Quotabunga clip ranges", () => {
  // Rows and backends from before clip end times omit the field entirely.
  const legacyEntry = {
    id: "quote-1",
    quoteText: "Hold on to ya",
    sourceTitle: "Heat",
    sourceType: "MOVIE",
    clipUrl: "https://youtu.be/abcdefghijk",
    clipStartSeconds: 42.5,
    listenerNotes: null,
    status: "SUBMITTED",
    bracketOrder: null,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
  };

  test("reads entries saved without an end time and forwards a fractional range", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ episode: null, isOpen: true, submission: legacyEntry });
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({ ...legacyEntry, clipEndSeconds: 50.25 })
      .mockResolvedValueOnce({ ...legacyEntry, clipEndSeconds: "later" });
    const client = { query, mutation } as unknown as ConvexReactClient;

    const current = await loadConvexQuotabunga(client, "episode-test");
    expect(current.submission).toMatchObject({
      clipStartSeconds: 42.5,
      clipEndSeconds: null,
    });
    const content = {
      quoteText: legacyEntry.quoteText,
      sourceTitle: legacyEntry.sourceTitle,
      sourceType: "MOVIE" as const,
      clipUrl: legacyEntry.clipUrl,
      clipStartSeconds: 42.5,
      clipEndSeconds: 50.25,
      listenerNotes: null,
    };
    await expect(
      submitConvexQuotabunga(client, "episode-test", content)
    ).resolves.toMatchObject({ clipEndSeconds: 50.25 });
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        episodeId: "episode-test",
        clipStartSeconds: 42.5,
        clipEndSeconds: 50.25,
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
    await expect(
      submitConvexQuotabunga(client, "episode-test", content)
    ).rejects.toThrow();
  });
});
