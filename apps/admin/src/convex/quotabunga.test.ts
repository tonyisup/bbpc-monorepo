import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  awardConvexAdminQuotePlacements,
  createConvexAdminQuoteForUser,
  deleteConvexAdminQuote,
  loadConvexAdminQuoteEpisodes,
  loadConvexAdminQuoteSubmissions,
  randomizeConvexAdminQuotes,
  setConvexAdminQuoteStatus,
  snapshotConvexQuoteAwards,
  updateConvexAdminQuoteContent,
} from "./quotabunga";

const episode = {
  id: "episode-1",
  number: 123,
  title: "The Quotabunga Episode",
  status: "recording",
};

const submission = {
  id: "quote-1",
  quoteText: "A synthetic quote",
  sourceTitle: "A synthetic movie",
  sourceType: "MOVIE" as const,
  clipUrl: null,
  clipStartSeconds: null,
  listenerNotes: null,
  status: "INCLUDED" as const,
  bracketOrder: 1,
  placement: 1 as const,
  scored: true,
  createdAt: 100,
  updatedAt: 200,
  userId: "user-1",
  episodeId: episode.id,
  seasonId: "season-1",
  adminNotes: null,
  user: {
    id: "user-1",
    name: "Example User",
    email: "user@example.invalid",
    image: null,
  },
  episode,
  season: {
    id: "season-1",
    title: "Season One",
  },
  point: {
    id: "point-1",
    adjustment: 40,
    reason: "Quotabunga winner",
  },
};

const content = {
  quoteText: submission.quoteText,
  sourceTitle: submission.sourceTitle,
  sourceType: submission.sourceType,
  clipUrl: null,
  clipStartSeconds: null,
  listenerNotes: null,
};

describe("Convex Quotabunga admin adapter", () => {
  test("validates bounded administrator reads", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          ...episode,
          submissionCount: 1,
        },
      ])
      .mockResolvedValueOnce([submission]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminQuoteEpisodes(client)).resolves.toEqual([
      { ...episode, submissionCount: 1 },
    ]);
    await expect(
      loadConvexAdminQuoteSubmissions(client, episode.id)
    ).resolves.toEqual([submission]);
    expect(query).toHaveBeenNthCalledWith(1, expect.anything(), {});
    expect(query).toHaveBeenNthCalledWith(2, expect.anything(), {
      episodeId: episode.id,
    });
  });

  test("versions every write and sends exact award snapshots", async () => {
    const unscored = {
      ...submission,
      placement: null,
      scored: false,
      point: null,
    };
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(unscored)
      .mockResolvedValueOnce(unscored)
      .mockResolvedValueOnce({ ...unscored, status: "REJECTED" })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ awarded: 1, cleared: 0 })
      .mockResolvedValueOnce({ id: submission.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await createConvexAdminQuoteForUser(client, {
      ...content,
      episodeId: episode.id,
      userId: submission.userId,
      today: "2030-01-02",
    });
    await updateConvexAdminQuoteContent(client, {
      ...content,
      id: submission.id,
      adminNotes: "Private",
    });
    await setConvexAdminQuoteStatus(client, submission.id, "REJECTED");
    await randomizeConvexAdminQuotes(client, episode.id, "round-seed");

    const expectedAwards = snapshotConvexQuoteAwards([submission]);
    await awardConvexAdminQuotePlacements(
      client,
      episode.id,
      [{ submissionId: submission.id, placement: 1 }],
      expectedAwards
    );
    await deleteConvexAdminQuote(client, submission);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
    expect(mutation).toHaveBeenNthCalledWith(5, expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId: episode.id,
      placements: [{ submissionId: submission.id, placement: 1 }],
      expectedAwards: [
        {
          submissionId: submission.id,
          pointId: submission.point.id,
          placement: 1,
        },
      ],
    });
    expect(mutation).toHaveBeenNthCalledWith(6, expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: submission.id,
      expectedAward: {
        pointId: submission.point.id,
        placement: 1,
      },
    });
  });

  test("rejects drifted canonical relationships and scored state", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          ...submission,
          userId: "different-user",
        },
      ])
      .mockResolvedValueOnce([
        {
          ...submission,
          scored: false,
        },
      ]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAdminQuoteSubmissions(client, episode.id)
    ).rejects.toThrow();
    await expect(
      loadConvexAdminQuoteSubmissions(client, episode.id)
    ).rejects.toThrow();
  });
});
