import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_ASSIGNMENT_AUDIO_PAGE_SIZE,
  createConvexAssignmentGuess,
  createConvexAssignmentReview,
  deleteConvexAssignment,
  loadConvexAssignmentAudioPage,
  loadConvexAssignmentWorkbench,
  loadConvexAssignmentWorkbenchById,
  removeConvexAssignmentAudio,
  removeConvexAssignmentGuess,
  updateConvexAssignmentIdentity,
  updateConvexAssignmentReviewRating,
  updateConvexAssignmentPlayable,
  updateConvexAssignmentSlug,
  updateConvexAssignmentWagerStatus,
} from "./assignmentDetails";

const assignment = {
  id: "assignment-1",
  type: "HOMEWORK" as const,
  playable: false,
  slug: "assignment-one",
  user: {
    id: "user-1",
    name: "Assigned User",
    image: null,
    status: "active" as const,
  },
  movie: {
    id: "movie-1",
    title: "Assigned Movie",
    year: 2024,
    poster: null,
    url: "https://catalog.example.test/movie-1",
    tmdbId: 123,
  },
  episode: {
    id: "episode-1",
    number: 12,
    title: "Episode Twelve",
    status: "published",
    slug: "episode-twelve",
  },
};

const review = {
  id: "assignment-review-1",
  reviewId: "review-1",
  reviewer: {
    id: "user-2",
    name: "Reviewer",
    status: "active" as const,
  },
  rating: {
    id: "rating-1",
    name: "Good",
    value: 3,
  },
  reviewedAt: 100,
  guesses: [
    {
      id: "guess-1",
      createdAt: 101,
      user: {
        id: "user-3",
        name: "Guesser",
        status: "active" as const,
      },
      rating: {
        id: "rating-2",
        name: "Best",
        value: 4,
      },
      season: {
        id: "season-1",
        title: "Season One",
      },
      hasPoint: false,
    },
  ],
};

const wager = {
  id: "wager-1",
  points: 5,
  createdAt: 102,
  status: "pending" as const,
  user: {
    id: "user-3",
    name: "Guesser",
    status: "active" as const,
  },
  targetUser: null,
  gamblingType: {
    id: "gambling-type-1",
    title: "Default",
    multiplier: 2,
  },
  awardAdjustment: null,
};

const workbench = {
  assignment,
  reviews: [review],
  wagers: [wager],
};

const audioMessage = {
  id: "audio-1",
  url: "https://audio.example.test/assignment.webm",
  createdAt: 103,
  fileKey: null,
  assignmentId: assignment.id,
  user: {
    id: "user-2",
    name: "Reviewer",
    email: "reviewer@example.test",
    image: null,
    status: "active" as const,
  },
};

describe("Convex assignment detail adapter", () => {
  test("resolves the canonical slug and validates bounded workbench data", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        id: assignment.id,
        slug: assignment.slug,
      })
      .mockResolvedValueOnce(workbench);
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAssignmentWorkbench(client, assignment.slug)
    ).resolves.toEqual(workbench);

    const directQuery = vi.fn().mockResolvedValue(workbench);
    const directClient = {
      query: directQuery,
    } as unknown as ConvexReactClient;
    await expect(
      loadConvexAssignmentWorkbenchById(directClient, assignment.id)
    ).resolves.toEqual(workbench);
    expect(directQuery).toHaveBeenCalledWith(expect.anything(), {
      id: assignment.id,
    });
  });

  test("sends exact assignment, review, guess, and wager snapshots", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(assignment)
      .mockResolvedValueOnce({ ...assignment, playable: true })
      .mockResolvedValue({ id: "result-1" });
    const client = { mutation } as unknown as ConvexReactClient;

    await updateConvexAssignmentSlug(client, assignment, "new-slug");
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      slug: "new-slug",
      expectedSlug: assignment.slug,
    });

    await updateConvexAssignmentPlayable(client, assignment, true);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      playable: true,
      expectedPlayable: assignment.playable,
    });

    await deleteConvexAssignment(client, assignment);
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        expected: expect.objectContaining({
          userId: assignment.user.id,
          movieId: assignment.movie.id,
          episodeId: assignment.episode.id,
        }),
      })
    );

    await updateConvexAssignmentReviewRating(
      client,
      review,
      "rating-2"
    );
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedRatingId: review.rating.id,
      })
    );

    const firstGuess = review.guesses[0];
    if (firstGuess === undefined) {
      throw new Error("Expected a guess fixture.");
    }
    await removeConvexAssignmentGuess(client, review.id, firstGuess);
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        expected: expect.objectContaining({
          assignmentReviewId: review.id,
          ratingId: firstGuess.rating.id,
          hasPoint: false,
        }),
      })
    );

    await updateConvexAssignmentWagerStatus(client, wager, "won");
    expect(mutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "won",
        expectedStatus: "pending",
      })
    );
  });

  test("updates assignment identity atomically with the loaded snapshot", async () => {
    const updated = {
      ...assignment,
      type: "BONUS" as const,
      playable: true,
      slug: "new-slug",
    };
    const mutation = vi.fn().mockResolvedValue(updated);
    const client = { mutation } as unknown as ConvexReactClient;

    await expect(
      updateConvexAssignmentIdentity(client, {
        assignment,
        type: "BONUS",
        playable: true,
        slug: "new-slug",
      })
    ).resolves.toEqual(updated);
    expect(mutation).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      type: "BONUS",
      playable: true,
      slug: "new-slug",
      expected: {
        type: assignment.type,
        playable: assignment.playable,
        slug: assignment.slug,
      },
    });
  });

  test("versions relationship creation and bounded audio metadata", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [audioMessage],
      isDone: true,
      continueCursor: "done",
    });
    const mutation = vi.fn().mockResolvedValue({ id: "result-1" });
    const client = { query, mutation } as unknown as ConvexReactClient;

    await createConvexAssignmentReview(client, {
      assignmentId: assignment.id,
      userId: "user-2",
      ratingId: null,
    });
    await createConvexAssignmentGuess(client, {
      userId: "user-3",
      assignmentReviewId: review.id,
      ratingId: "rating-2",
      seasonId: "season-1",
    });
    await expect(
      loadConvexAssignmentAudioPage(client, assignment.id, null)
    ).resolves.toMatchObject({
      messages: [audioMessage],
      isDone: true,
    });
    expect(query).toHaveBeenCalledWith(expect.anything(), {
      assignmentId: assignment.id,
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_ASSIGNMENT_AUDIO_PAGE_SIZE,
      },
    });
    await removeConvexAssignmentAudio(client, audioMessage);
    expect(mutation).toHaveBeenLastCalledWith(expect.anything(), {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: audioMessage.id,
      expected: {
        assignmentId: assignment.id,
        userId: audioMessage.user.id,
        url: audioMessage.url,
        fileKey: null,
        createdAt: audioMessage.createdAt,
      },
    });
  });

  test("rejects slug drift and cross-assignment audio", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        id: assignment.id,
        slug: assignment.slug,
      })
      .mockResolvedValueOnce({
        ...workbench,
        assignment: { ...assignment, slug: "changed" },
      })
      .mockResolvedValueOnce({
        page: [
          {
            ...audioMessage,
            assignmentId: "assignment-2",
          },
        ],
        isDone: true,
        continueCursor: "done",
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexAssignmentWorkbench(client, assignment.slug)
    ).rejects.toThrow(/slug changed/u);
    await expect(
      loadConvexAssignmentAudioPage(client, assignment.id, null)
    ).rejects.toThrow(/requested assignment/u);
  });
});
