/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|dashboard-admin",
  issuer: "https://issuer.example.test",
  subject: "dashboard-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|dashboard-member",
  issuer: "https://issuer.example.test",
  subject: "dashboard-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedUser(
  t: TestBackend,
  input: {
    identity: typeof ADMIN_IDENTITY;
    name: string;
    email: string;
    admin?: boolean;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: input.email,
      normalizedEmail: input.email.toLowerCase(),
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...input.identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (input.admin === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Dashboard administrator",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: 1,
      });
    }
    return userId;
  });
}

describe("administrator dashboard API", () => {
  test("requires canonical administrator access", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      admin: true,
    });
    await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
    });

    await expectDomainError(
      t.query(api.admin.dashboard.overview, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(api.admin.dashboard.overview, {}),
      "FORBIDDEN",
    );
  });

  test("returns exact counts, recent content, and bounded guess totals", async () => {
    const t = createTestBackend();
    const adminId = await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      admin: true,
    });
    const memberId = await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
    });
    await t.run(async (ctx) => {
      const movieId = await ctx.db.insert("movies", {
        title: "Dashboard Movie",
        normalizedTitle: "dashboard movie",
        year: 2026,
        url: "https://movies.example.test/dashboard",
      });
      const ratingId = await ctx.db.insert("ratings", {
        name: "Good",
        value: 3,
      });
      const gameTypeId = await ctx.db.insert("gameTypes", {
        title: "Predictions",
        lookupId: "wtfir",
        normalizedLookupId: "wtfir",
      });
      const seasonId = await ctx.db.insert("seasons", {
        title: "Season",
        gameTypeId,
      });
      const publishedId = await ctx.db.insert("episodes", {
        number: 10,
        title: "Published",
        date: "2026-07-20",
        status: "Published",
        recording: "published.mp3",
        slug: "episode-10-published",
        normalizedSlug: "episode-10-published",
      });
      await ctx.db.insert("episodes", {
        number: 11,
        title: "Upcoming",
        date: "2026-07-27",
        status: "next",
        recording: "upcoming.mp3",
        slug: "episode-11-upcoming",
        normalizedSlug: "episode-11-upcoming",
      });
      await ctx.db.insert("episodes", {
        number: 9,
        title: "Pending",
        status: "pending",
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: adminId,
        episodeId: publishedId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId: adminId,
        movieId,
        ratingId,
        reviewedAt: 1,
      });
      const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
        assignmentId,
        reviewId,
      });
      await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 1,
        userId: memberId,
        assignmentReviewId,
        seasonId,
      });
      await ctx.db.insert("syllabusEntries", {
        userId: memberId,
        movieId,
        order: 1,
        createdAt: 10,
      });
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(api.admin.dashboard.overview, {}),
    ).resolves.toMatchObject({
      counts: {
        episodes: 3,
        users: 2,
        movies: 1,
        reviews: 1,
      },
      latestEpisode: {
        number: 10,
        title: "Published",
      },
      upcomingEpisode: {
        number: 11,
        title: "Upcoming",
      },
      latestSyllabus: [
        {
          user: { name: "Member" },
          movie: { title: "Dashboard Movie" },
        },
      ],
      guessStats: [
        {
          name: "Ep 10",
          guesses: 1,
        },
        {
          name: "Ep 11",
          guesses: 0,
        },
      ],
    });
  });

  test("returns an empty but exact dashboard without content", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      admin: true,
    });

    const result = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.admin.dashboard.overview, {});
    expect(result).toMatchObject({
      counts: {
        episodes: 0,
        users: 1,
        movies: 0,
        reviews: 0,
      },
      latestEpisode: null,
      upcomingEpisode: null,
      latestSyllabus: [],
      guessStats: [],
    });
  });
});
