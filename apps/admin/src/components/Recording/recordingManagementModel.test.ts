import { describe, expect, it, vi } from "vitest";

import type {
  ConvexAdminSeasonGamblingEntry,
  ConvexAdminSeasonGuess,
} from "../../convex/seasonDetails";
import type { ConvexAdminUser } from "../../convex/users";
import {
  chunkRecordingValues,
  collectAllRecordingAudioMessages,
  collectAllRecordingUsers,
  getAssignmentRecordingDisclosure,
  getRecordingGuessSettlementPreview,
  groupRecordingGuessesByListener,
  isRecordingGuessRevealed,
  selectRecordingManagementEpisode,
  summarizeEpisodePoints,
} from "./recordingManagementModel";

function adminUser(
  id: string,
  options: { isAdmin?: boolean; status?: "active" | "disabled" } = {}
): ConvexAdminUser {
  return {
    id,
    legacyId: null,
    name: id,
    email: `${id}@example.com`,
    image: null,
    status: options.status ?? "active",
    createdAt: 1,
    updatedAt: 1,
    isAdmin: options.isAdmin ?? false,
    roles: [],
    nextSyllabus: null,
  };
}

const gameType = {
  id: "game-type",
  title: "Predictions",
  description: null,
  lookupId: "predictions",
};
const season = {
  id: "season",
  title: "Season",
  description: null,
  startedOn: "2026-01-01",
  endedOn: null,
  gameType,
};
const rating = {
  id: "rating",
  name: "Good",
  value: 4,
  sound: null,
  icon: null,
  category: null,
};
const movie = {
  id: "movie",
  title: "Movie",
  year: 2026,
  poster: null,
  url: "movie",
  tmdbId: null,
};
const episode = {
  id: "episode",
  number: 1,
  title: "Episode",
  status: "recording",
  slug: "episode",
};

function point(userId: string, total: number) {
  return {
    id: `point-${userId}-${String(total)}`,
    user: { id: userId, name: userId, image: null },
    season,
    reason: "Award",
    earnedAt: 1,
    adjustment: total,
    gamePointType: null,
    total,
  };
}

function guess(
  userId: string,
  options: {
    hostRated?: boolean;
    pointTotal?: number;
    hostId?: string;
    correct?: boolean;
  } = {}
): ConvexAdminSeasonGuess {
  const hostId = options.hostId ?? "host";
  return {
    id: `guess-${userId}-${hostId}`,
    createdAt: 1,
    user: { id: userId, name: userId, image: null },
    rating,
    assignmentReview: {
      id: "assignment-review",
      assignment: {
        id: "assignment",
        type: "HOMEWORK",
        playable: true,
        episode,
      },
      review: {
        id: "review",
        user: {
          id: hostId,
          name: hostId,
          image: null,
          status: "active",
        },
        movie,
        show: null,
        rating: options.hostRated
          ? options.correct === false
            ? { ...rating, id: "other-rating" }
            : rating
          : null,
        reviewedAt: options.hostRated ? 1 : null,
      },
    },
    season,
    point:
      options.pointTotal === undefined
        ? null
        : point(userId, options.pointTotal),
  };
}

function wager(userId: string, total: number): ConvexAdminSeasonGamblingEntry {
  return {
    id: `wager-${userId}`,
    points: 2,
    createdAt: 1,
    notes: null,
    status: "lost",
    user: { id: userId, name: userId, image: null },
    assignment: null,
    gamblingType: {
      id: "gambling-type",
      lookupId: "bet",
      title: "Bet",
      description: null,
      multiplier: 2,
      isActive: true,
      createdAt: 1,
    },
    targetUser: null,
    season,
    awardPoint: point(userId, total),
  };
}

describe("recording management model", () => {
  it("selects the same upcoming episode as Quotabunga when an older episode is still recording", () => {
    const recordingEpisode = {
      id: "episode-11",
      number: 11,
      status: "recording",
    };
    const nextEpisode = {
      id: "episode-12",
      number: 12,
      status: "next",
    };

    expect(
      selectRecordingManagementEpisode([nextEpisode, recordingEpisode])
    ).toBe(nextEpisode);
  });

  it("selects the latest next episode regardless of catalog order", () => {
    const olderNextEpisode = {
      id: "episode-11",
      number: 11,
      status: "next",
    };
    const latestNextEpisode = {
      id: "episode-12",
      number: 12,
      status: "next",
    };

    expect(
      selectRecordingManagementEpisode([olderNextEpisode, latestNextEpisode])
    ).toBe(latestNextEpisode);
  });

  it("falls back to the recording episode when no next episode exists", () => {
    const recordingEpisode = {
      id: "episode-11",
      number: 11,
      status: "recording",
    };

    expect(selectRecordingManagementEpisode([recordingEpisode])).toBe(
      recordingEpisode
    );
  });

  it("falls back to the newest available episode like Quotabunga", () => {
    const latestEpisode = {
      id: "episode-12",
      number: 12,
      status: "pending",
    };
    const olderEpisode = {
      id: "episode-11",
      number: 11,
      status: "published",
    };

    expect(
      selectRecordingManagementEpisode([latestEpisode, olderEpisode])
    ).toBe(latestEpisode);
  });

  it("returns null when the episode catalog is empty", () => {
    expect(selectRecordingManagementEpisode([])).toBeNull();
  });

  it("loads every user page instead of failing after 100 users", async () => {
    const users = Array.from({ length: 125 }, (_, index) =>
      adminUser(`user-${String(index)}`)
    );
    const loadPage = vi.fn(async (cursor: string | null) => {
      const offset = cursor === null ? 0 : Number(cursor);
      const nextOffset = offset + 50;
      return {
        users: users.slice(offset, nextOffset),
        isDone: nextOffset >= users.length,
        continueCursor: String(nextOffset),
      };
    });

    await expect(collectAllRecordingUsers(loadPage)).resolves.toEqual(users);
    expect(loadPage.mock.calls).toEqual([[null], ["50"], ["100"]]);
  });

  it("fails closed when pagination repeats a cursor", async () => {
    await expect(
      collectAllRecordingUsers(async () => ({
        users: [],
        isDone: false,
        continueCursor: "same",
      }))
    ).rejects.toThrow("repeated pagination cursor");
  });

  it("loads every submitted audio message across pages", async () => {
    const messages = [{ id: "audio-1" }, { id: "audio-2" }, { id: "audio-3" }];
    const loadPage = vi.fn(async (cursor: string | null) => {
      const offset = cursor === null ? 0 : Number(cursor);
      const nextOffset = offset + 2;
      return {
        messages: messages.slice(offset, nextOffset),
        isDone: nextOffset >= messages.length,
        continueCursor: String(nextOffset),
      };
    });

    await expect(collectAllRecordingAudioMessages(loadPage)).resolves.toEqual(
      messages
    );
    expect(loadPage.mock.calls).toEqual([[null], ["2"]]);
  });

  it("fails closed when audio pagination repeats a cursor", async () => {
    await expect(
      collectAllRecordingAudioMessages(async () => ({
        messages: [],
        isDone: false,
        continueCursor: "same",
      }))
    ).rejects.toThrow("repeated pagination cursor");
  });

  it("chunks point-total requests to the backend limit", () => {
    expect(chunkRecordingValues(Array.from({ length: 205 }), 100)).toHaveLength(
      3
    );
    expect(
      chunkRecordingValues(Array.from({ length: 205 }), 100).map(
        (chunk) => chunk.length
      )
    ).toEqual([100, 100, 5]);
  });

  it("reveals wagers only after every active administrator has rated", () => {
    const users = [
      adminUser("host-1", { isAdmin: true }),
      adminUser("host-2", { isAdmin: true }),
      adminUser("disabled-host", { isAdmin: true, status: "disabled" }),
      adminUser("member"),
    ];
    const oneRated = getAssignmentRecordingDisclosure(users, [
      { reviewer: { id: "host-1" }, rating: rating },
      { reviewer: { id: "host-2" }, rating: null },
    ]);
    expect(oneRated).toEqual({
      activeHostCount: 2,
      ratedHostCount: 1,
      allHostsRated: false,
    });

    expect(
      getAssignmentRecordingDisclosure(users, [
        { reviewer: { id: "host-1" }, rating },
        { reviewer: { id: "host-2" }, rating },
      ]).allHostsRated
    ).toBe(true);
  });

  it("keeps guesses concealed until their targeted host rates", () => {
    expect(isRecordingGuessRevealed(guess("listener"))).toBe(false);
    expect(
      isRecordingGuessRevealed(guess("listener", { hostRated: true }))
    ).toBe(true);
  });

  it("groups guesses by listener while preserving their original order", () => {
    const listenerAFirst = guess("listener-a");
    const listenerBGuess = guess("listener-b");
    const listenerASecond = {
      ...guess("listener-a", { hostRated: true }),
      id: "guess-listener-a-second",
    };

    const groups = groupRecordingGuessesByListener([
      listenerAFirst,
      listenerBGuess,
      listenerASecond,
    ]);

    expect(groups.map(({ user }) => user.id)).toEqual([
      "listener-a",
      "listener-b",
    ]);
    expect(groups[0]?.guesses.map(({ id }) => id)).toEqual([
      listenerAFirst.id,
      listenerASecond.id,
    ]);
    expect(groups[1]?.guesses.map(({ id }) => id)).toEqual([listenerBGuess.id]);
  });

  it("previews all-correct, all-incorrect, and mixed settlements", () => {
    const guessesFor = (correct: boolean[]) =>
      correct.map((isCorrect, index) =>
        guess("listener", {
          hostId: `host-${String(index + 1)}`,
          hostRated: true,
          correct: isCorrect,
        })
      );

    expect(
      getRecordingGuessSettlementPreview(guessesFor([true, true, true]))
    ).toMatchObject({
      eligible: true,
      correctCount: 3,
      outcome: "allcorrect",
    });
    expect(
      getRecordingGuessSettlementPreview(guessesFor([false, false, false]))
    ).toMatchObject({
      eligible: true,
      correctCount: 0,
      outcome: "all-incorrect",
    });
    expect(
      getRecordingGuessSettlementPreview(guessesFor([true, false, true]))
    ).toMatchObject({
      eligible: true,
      correctCount: 2,
      outcome: "mixed",
    });
  });

  it("waits for exactly three distinct rated hosts before settlement", () => {
    expect(
      getRecordingGuessSettlementPreview([
        guess("listener", { hostId: "host-1", hostRated: true }),
        guess("listener", { hostId: "host-2" }),
        guess("listener", { hostId: "host-3", hostRated: true }),
      ])
    ).toMatchObject({
      eligible: false,
      message: "Waiting for all 3 host ratings",
    });
    expect(
      getRecordingGuessSettlementPreview([
        guess("listener", { hostId: "host-1", hostRated: true }),
        guess("listener", { hostId: "host-2", hostRated: true }),
      ])
    ).toMatchObject({
      eligible: false,
      message: "2 of 3 guesses recorded",
    });
    expect(
      getRecordingGuessSettlementPreview([
        guess("listener", { hostId: "host-1", hostRated: true }),
        guess("listener", { hostId: "host-1", hostRated: true }),
        guess("listener", { hostId: "host-3", hostRated: true }),
      ])
    ).toMatchObject({
      eligible: false,
      message: "Guesses must target 3 distinct hosts",
    });
    expect(
      getRecordingGuessSettlementPreview([
        guess("listener", { hostId: "host-1", hostRated: true }),
        guess("listener", { hostId: "host-2", hostRated: true }),
        {
          ...guess("listener", { hostId: "host-3", hostRated: true }),
          season: { ...season, id: "other-season" },
        },
      ])
    ).toMatchObject({
      eligible: false,
      message: "Guesses must belong to the same season",
    });
  });

  it("keeps episode point sources separate and sorts by exact total", () => {
    const listenerA = adminUser("listener-a");
    const listenerB = adminUser("listener-b");
    const rows = summarizeEpisodePoints(
      [guess(listenerA.id, { hostRated: true, pointTotal: 2 })],
      [wager(listenerB.id, -4)],
      [
        {
          user: listenerB,
          point: { adjustment: 10 },
        },
      ],
      [
        {
          userId: listenerA.id,
          assignmentId: "assignment",
          total: 3,
        },
      ],
      [listenerA, listenerB]
    );

    expect(rows).toMatchObject([
      {
        user: { id: listenerB.id },
        guessPoints: 0,
        gamblingPoints: -4,
        quotabungaPoints: 10,
        bonusPoints: 0,
        total: 6,
      },
      {
        user: { id: listenerA.id },
        guessPoints: 2,
        gamblingPoints: 0,
        quotabungaPoints: 0,
        bonusPoints: 3,
        total: 5,
      },
    ]);
  });
});
