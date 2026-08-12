import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  applyConvexUserVotePoints,
  assignConvexUserRole,
  assignConvexUserSyllabusEpisode,
  createConvexUserPoint,
  createConvexUserWager,
  deleteConvexUserVote,
  loadConvexUserDetail,
  loadConvexUserGamblingPage,
  loadConvexUserGuessesPage,
  loadConvexUserPointsPage,
  loadConvexUserPointTotal,
  loadConvexUserSyllabus,
  loadConvexUserVotesPage,
  removeConvexUserRole,
  removeConvexUserSyllabusEntry,
  reorderConvexUserPendingSyllabus,
  setConvexUserStatus,
  unlinkConvexUserSyllabusEpisode,
  updateConvexUserProfile,
  updateConvexUserWagerPoints,
  updateConvexUserWagerStatus,
} from "./userDetails";

const role = {
  id: "role-1",
  legacyId: 1,
  name: "Producer",
  description: "Can produce episodes",
  admin: false,
  permissions: ["episodes:write"],
};

const membership = {
  id: "membership-1",
  assignedAt: 25,
  assignedBy: "user-admin",
  role,
};

const adminUser = {
  id: "user-1",
  legacyId: "legacy-user-1",
  name: "Example User",
  email: "user@example.invalid",
  image: null,
  status: "active" as const,
  createdAt: 10,
  updatedAt: 20,
  isAdmin: false,
  roles: [membership],
  nextSyllabus: {
    id: "syllabus-1",
    order: 1,
    notes: "Watch next",
    movie: {
      id: "movie-1",
      title: "Arrival",
    },
  },
};

const pointUser = {
  id: adminUser.id,
  name: adminUser.name,
  image: adminUser.image,
};

const gameType = {
  id: "game-type-1",
  title: "League",
  description: null,
  lookupId: "league",
};

const season = {
  id: "season-1",
  title: "Season One",
  description: "The first season",
  startedOn: "2026-01-01",
  endedOn: null,
  gameType,
};

const point = {
  id: "point-1",
  user: pointUser,
  season,
  reason: "Manual award",
  earnedAt: 100,
  adjustment: 3,
  gamePointType: null,
  total: 3,
};

const rating = {
  id: "rating-1",
  name: "Great",
  value: 4,
  sound: null,
  icon: null,
  category: null,
};

const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://example.invalid/arrival",
  tmdbId: 329865,
};

const episode = {
  id: "episode-1",
  number: 1,
  title: "Episode One",
  status: "published",
  slug: "episode-one",
};

const reviewUser = {
  ...pointUser,
  status: "active" as const,
};

const guess = {
  id: "guess-1",
  createdAt: 110,
  user: pointUser,
  rating,
  assignmentReview: {
    id: "assignment-review-1",
    assignment: {
      id: "assignment-1",
      type: "HOMEWORK",
      playable: true,
      episode,
    },
    review: {
      id: "review-1",
      user: reviewUser,
      movie,
      show: null,
      rating,
      reviewedAt: 90,
    },
  },
  season,
  point: null,
};

const assignment = {
  id: "assignment-1",
  type: "HOMEWORK" as const,
  playable: true,
  slug: "assignment-1",
  user: reviewUser,
  movie,
  episode,
};

const gamblingEntry = {
  id: "gambling-1",
  points: 5,
  createdAt: 120,
  notes: null,
  status: "pending" as const,
  user: pointUser,
  assignment,
  gamblingType: {
    id: "gambling-type-1",
    lookupId: "default",
    title: "Default wager",
    description: null,
    multiplier: 1.5,
    isActive: true,
    createdAt: 1,
  },
  targetUser: null,
  season,
  awardPoint: null,
};

const syllabusEntry = {
  id: "syllabus-1",
  order: 1,
  createdAt: 50,
  notes: "Watch next",
  movie,
  assignment: {
    id: assignment.id,
    type: assignment.type,
    playable: assignment.playable,
    slug: assignment.slug,
    episode,
  },
  user: {
    id: adminUser.id,
    name: adminUser.name,
    email: adminUser.email,
    status: adminUser.status,
  },
};

const tagVote = {
  id: "vote-1",
  tag: "space",
  tmdbId: movie.tmdbId,
  isTag: true,
  createdAt: 130,
  user: pointUser,
  award: {
    kind: "unawarded" as const,
  },
};

function page<T>(item: T) {
  return {
    page: [item],
    isDone: true,
    continueCursor: "",
  };
}

describe("Convex user detail adapter", () => {
  test("validates exact detail, syllabus, totals, and bounded activity pages", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(adminUser)
      .mockResolvedValueOnce([syllabusEntry])
      .mockResolvedValueOnce(page(point))
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(page(guess))
      .mockResolvedValueOnce(page(gamblingEntry))
      .mockResolvedValueOnce(page(tagVote));
    const client = { query } as unknown as ConvexReactClient;

    await expect(
      loadConvexUserDetail(client, adminUser.id)
    ).resolves.toEqual(adminUser);
    await expect(
      loadConvexUserSyllabus(client, adminUser.id)
    ).resolves.toEqual([syllabusEntry]);
    await expect(
      loadConvexUserPointsPage(
        client,
        adminUser.id,
        { kind: "season", seasonId: season.id },
        null
      )
    ).resolves.toMatchObject({ items: [{ id: point.id }], isDone: true });
    await expect(
      loadConvexUserPointTotal(client, adminUser.id, { kind: "all" })
    ).resolves.toBe(3);
    await expect(
      loadConvexUserGuessesPage(
        client,
        adminUser.id,
        { kind: "current", today: "2026-07-24" },
        null
      )
    ).resolves.toMatchObject({ items: [{ id: guess.id }], isDone: true });
    await expect(
      loadConvexUserGamblingPage(
        client,
        adminUser.id,
        { kind: "season", seasonId: season.id },
        null
      )
    ).resolves.toMatchObject({
      items: [{ id: gamblingEntry.id }],
      isDone: true,
    });
    await expect(
      loadConvexUserVotesPage(client, adminUser.id, null)
    ).resolves.toMatchObject({ items: [{ id: tagVote.id }], isDone: true });
  });

  test("rejects cross-user and selected-season activity", async () => {
    const otherUser = { ...pointUser, id: "user-2" };
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ ...syllabusEntry, user: { ...syllabusEntry.user, id: otherUser.id } }])
      .mockResolvedValueOnce(page({ ...point, user: otherUser }))
      .mockResolvedValueOnce(
        page({ ...guess, season: { ...season, id: "season-2" } })
      )
      .mockResolvedValueOnce(page({ ...gamblingEntry, user: otherUser }))
      .mockResolvedValueOnce(page({ ...tagVote, user: null }));
    const client = { query } as unknown as ConvexReactClient;
    const selectedSeason = {
      kind: "season" as const,
      seasonId: season.id,
    };

    await expect(
      loadConvexUserSyllabus(client, adminUser.id)
    ).rejects.toThrow(/requested user/u);
    await expect(
      loadConvexUserPointsPage(
        client,
        adminUser.id,
        selectedSeason,
        null
      )
    ).rejects.toThrow(/requested user/u);
    await expect(
      loadConvexUserGuessesPage(
        client,
        adminUser.id,
        selectedSeason,
        null
      )
    ).rejects.toThrow(/selected season/u);
    await expect(
      loadConvexUserGamblingPage(
        client,
        adminUser.id,
        selectedSeason,
        null
      )
    ).rejects.toThrow(/requested user/u);
    await expect(
      loadConvexUserVotesPage(client, adminUser.id, null)
    ).rejects.toThrow(/missing its user/u);
  });

  test("forwards exact identity and syllabus snapshots", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(adminUser)
      .mockResolvedValueOnce({ ...adminUser, status: "disabled" })
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce({ id: membership.id })
      .mockResolvedValueOnce(syllabusEntry)
      .mockResolvedValueOnce({ ...syllabusEntry, assignment: null })
      .mockResolvedValueOnce({ id: syllabusEntry.id })
      .mockResolvedValueOnce([syllabusEntry]);
    const client = { mutation } as unknown as ConvexReactClient;
    const profileExpected = {
      name: adminUser.name,
      email: adminUser.email,
      status: adminUser.status,
      updatedAt: adminUser.updatedAt,
    };
    const syllabusExpected = {
      userId: adminUser.id,
      movieId: movie.id,
      order: syllabusEntry.order,
      createdAt: syllabusEntry.createdAt,
      notes: syllabusEntry.notes,
      assignmentId: assignment.id,
    };

    await updateConvexUserProfile(client, adminUser, {
      name: "Updated User",
      email: "updated@example.invalid",
    });
    await setConvexUserStatus(client, adminUser, "disabled");
    await assignConvexUserRole(client, adminUser.id, role.id);
    await removeConvexUserRole(client, adminUser.id, membership);
    await assignConvexUserSyllabusEpisode(
      client,
      syllabusEntry,
      2,
      "BONUS"
    );
    await unlinkConvexUserSyllabusEpisode(client, syllabusEntry);
    await removeConvexUserSyllabusEntry(client, syllabusEntry);
    await reorderConvexUserPendingSyllabus(client, adminUser.id, [
      syllabusEntry,
    ]);

    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        id: adminUser.id,
        expected: profileExpected,
        name: "Updated User",
        email: "updated@example.invalid",
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        id: adminUser.id,
        expected: profileExpected,
        status: "disabled",
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      expect.objectContaining({
        id: membership.id,
        expected: {
          userId: adminUser.id,
          roleId: role.id,
          assignedAt: membership.assignedAt,
          assignedBy: membership.assignedBy,
        },
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      5,
      expect.anything(),
      expect.objectContaining({
        syllabusId: syllabusEntry.id,
        expected: syllabusExpected,
        episodeNumber: 2,
        assignmentType: "BONUS",
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      6,
      expect.anything(),
      expect.objectContaining({
        syllabusId: syllabusEntry.id,
        expected: syllabusExpected,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      7,
      expect.anything(),
      expect.objectContaining({
        id: syllabusEntry.id,
        expected: syllabusExpected,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      8,
      expect.anything(),
      expect.objectContaining({
        userId: adminUser.id,
        items: [{ id: syllabusEntry.id, expectedOrder: 1 }],
      })
    );
  });

  test("forwards exact game snapshots and mutation targets", async () => {
    const awardedVote = {
      ...tagVote,
      award: {
        kind: "point" as const,
        point: { id: point.id },
      },
    };
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(point)
      .mockResolvedValueOnce(gamblingEntry)
      .mockResolvedValueOnce({ ...gamblingEntry, status: "won" })
      .mockResolvedValueOnce({ ...gamblingEntry, points: 7 })
      .mockResolvedValueOnce(awardedVote)
      .mockResolvedValueOnce({ id: tagVote.id });
    const client = { mutation } as unknown as ConvexReactClient;
    const seasonTarget = {
      kind: "season" as const,
      seasonId: season.id,
    };

    await createConvexUserPoint(client, {
      userId: adminUser.id,
      season: seasonTarget,
      reason: null,
      adjustment: 3,
      gamePointTypeId: null,
    });
    await createConvexUserWager(client, {
      userId: adminUser.id,
      season: seasonTarget,
      points: 5,
      gamblingTypeId: gamblingEntry.gamblingType.id,
    });
    await updateConvexUserWagerStatus(
      client,
      gamblingEntry,
      "won",
      seasonTarget
    );
    await updateConvexUserWagerPoints(client, gamblingEntry, 7);
    await applyConvexUserVotePoints(client, tagVote.id, "2026-07-24");
    await deleteConvexUserVote(client, tagVote.id);

    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        userId: adminUser.id,
        season: seasonTarget,
        adjustment: 3,
      }
    );
    expect(mutation).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        id: gamblingEntry.id,
        status: "won",
        expectedStatus: "pending",
        season: seasonTarget,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      expect.objectContaining({
        id: gamblingEntry.id,
        expected: {
          points: gamblingEntry.points,
          status: gamblingEntry.status,
          awardPointId: null,
        },
        points: 7,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      5,
      expect.anything(),
      expect.objectContaining({
        id: tagVote.id,
        today: "2026-07-24",
      })
    );
  });
});
