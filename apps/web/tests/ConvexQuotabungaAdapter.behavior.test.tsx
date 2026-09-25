import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { checkConvexQuotabungaDuplicate } from "@/convex/quotabunga";

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
