import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  deleteConvexPoint,
  linkConvexPointAssignment,
  loadConvexPointGamePointTypes,
  loadConvexPointWorkbench,
  searchConvexPointAssignments,
  unlinkConvexPointAssignment,
  updateConvexPoint,
} from "./pointDetails";

const gameType = {
  id: "game-type-1",
  title: "Predictions",
  description: null,
  lookupId: "predictions",
};

const pointType = {
  id: "point-type-1",
  title: "Correct host",
  description: null,
  lookupId: "correct-host",
  points: 10,
  gameType,
};

const assignment = {
  id: "assignment-1",
  type: "HOMEWORK" as const,
  playable: false,
  slug: "assignment-one",
  user: {
    id: "user-2",
    name: "Assignee",
    image: null,
    status: "active" as const,
  },
  movie: {
    id: "movie-1",
    title: "Movie One",
    year: 2025,
    poster: null,
    url: "https://catalog.example.test/movie-1",
    tmdbId: 101,
  },
  episode: {
    id: "episode-1",
    number: 12,
    title: "Episode Twelve",
    status: "published",
    slug: "episode-twelve",
  },
};

const point = {
  id: "point-1",
  user: {
    id: "user-1",
    name: "Point User",
    image: null,
  },
  season: {
    id: "season-1",
    title: "Season One",
    description: null,
    startedOn: "2025-01-01",
    endedOn: "2025-12-31",
    gameType,
  },
  reason: "Correct prediction",
  earnedAt: 100,
  adjustment: 2,
  gamePointType: pointType,
  total: 12,
  assignmentLinks: [{ id: "point-link-1", assignment }],
  guesses: [
    {
      id: "guess-1",
      assignmentReviewId: "assignment-review-1",
    },
  ],
  gamblingEntries: [{ id: "gambling-entry-1" }],
  tagVotes: [{ id: "tag-vote-1", tag: "funny" }],
  quoteSubmissions: [{ id: "quote-1" }],
};

const workbench = {
  point,
  impact: {
    assignmentLinkCount: 1,
    guessCount: 1,
    gamblingEntryCount: 1,
    tagVoteCount: 1,
    quoteSubmissionCount: 1,
  },
  guessAssignments: [
    {
      id: "guess-1",
      assignmentReviewId: "assignment-review-1",
      assignment,
    },
  ],
};

describe("Convex point detail adapter", () => {
  test("validates the bounded point workbench, point types, and search", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(workbench)
      .mockResolvedValueOnce([pointType])
      .mockResolvedValueOnce([assignment]);
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexPointWorkbench(client, point.id)
    ).resolves.toEqual(workbench);
    await expect(
      loadConvexPointGamePointTypes(client)
    ).resolves.toEqual([pointType]);
    await expect(
      searchConvexPointAssignments(client, "Movie")
    ).resolves.toEqual([assignment]);
  });

  test("sends exact point, link, and deletion snapshots", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(point)
      .mockResolvedValueOnce({ id: "point-link-2", assignment })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ id: point.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await updateConvexPoint(client, point, {
      reason: null,
      adjustment: 4,
      gamePointTypeId: null,
    });
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: point.id,
      expected: {
        userId: point.user.id,
        seasonId: point.season.id,
        reason: point.reason,
        adjustment: point.adjustment,
        gamePointTypeId: point.gamePointType.id,
        earnedAt: point.earnedAt,
      },
      reason: null,
      adjustment: 4,
      gamePointTypeId: null,
    });

    await linkConvexPointAssignment(client, point.id, assignment.id);
    const assignmentLink = point.assignmentLinks[0];
    if (assignmentLink === undefined) {
      throw new Error("Expected a point assignment link fixture.");
    }
    await unlinkConvexPointAssignment(
      client,
      point.id,
      assignmentLink
    );
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        pointId: point.id,
        assignmentId: assignment.id,
        expectedLinkId: assignmentLink.id,
      })
    );

    await deleteConvexPoint(client, workbench);
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: point.id,
        expectedImpact: workbench.impact,
        expected: expect.objectContaining({
          earnedAt: point.earnedAt,
        }),
      })
    );
  });

  test("rejects an oversized assignment search response", async () => {
    const query = vi.fn().mockResolvedValue(
      Array.from({ length: 31 }, (_, index) => ({
        ...assignment,
        id: `assignment-${String(index)}`,
      }))
    );
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      searchConvexPointAssignments(client, "Movie")
    ).rejects.toThrow();
  });
});
