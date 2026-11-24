/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { catalogSnapshotFingerprint } from "./lib/catalogSnapshot.js";
import schema from "./schema.js";
import {
  entryAverage,
  entrySum,
  isComplete,
  rankEntries,
  type LeaderboardCandidate,
  type ScorecardScores,
} from "./scorecard/leaderboard.js";
import {
  SCORECARD_CRITERIA,
  type ScorecardCriterion,
} from "./scorecard/limits.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "scorecard-api-test";
const V = BBPC_API_VERSION;

function identity(subject: string) {
  return {
    tokenIdentifier: `https://issuer.example.test|${subject}`,
    issuer: "https://issuer.example.test",
    subject,
  };
}
const MEMBER = identity("scorecard-member");
const OTHER = identity("scorecard-other");
const ADMIN = identity("scorecard-admin");

function createTestBackend() {
  return convexTest(schema, modules);
}
type TestBackend = ReturnType<typeof createTestBackend>;

async function expectDomainError(
  promise: Promise<unknown>,
  code: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) throw error;
    expect(error.data).toMatchObject({
      code,
      ...(details === undefined ? {} : { details }),
    });
    return;
  }
  throw new Error(`Expected domain error ${code}`);
}

function scoresWithSum(sum: number): Record<ScorecardCriterion, number> {
  // 9 whole numbers from 1-10 that add up to `sum` (9..90).
  const scores = {} as Record<ScorecardCriterion, number>;
  let remaining = sum;
  SCORECARD_CRITERIA.forEach((criterion, index) => {
    const left = SCORECARD_CRITERIA.length - index - 1;
    const value = Math.min(10, remaining - left);
    scores[criterion] = value;
    remaining -= value;
  });
  return scores;
}

async function seedUser(
  t: TestBackend,
  subject: ReturnType<typeof identity>,
  admin = false,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const email = `${subject.subject}@example.test`;
    const userId = await ctx.db.insert("users", {
      name: subject.subject,
      email,
      normalizedEmail: email,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...subject,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (admin) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", { userId, roleId, assignedAt: 1 });
    }
    return userId;
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "scorecard-api-test",
  });
  for (const [expectedStage, nextStage] of [
    ["S0", "S1"],
    ["S1", "S2"],
  ] as const) {
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage,
      nextStage,
      actor: "scorecard-api-test",
    });
  }
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "scorecard-api-test",
    approvedBackupId: "scorecard-backup",
    approvedBackupChecksum: "sha256:scorecard",
  });
}

async function seedMovies(
  t: TestBackend,
  movies: Array<{ title: string; year: number }>,
): Promise<Array<Id<"movies">>> {
  return await t.run(async (ctx) => {
    const ids: Array<Id<"movies">> = [];
    for (const [index, movie] of movies.entries()) {
      ids.push(
        await ctx.db.insert("movies", {
          title: movie.title,
          normalizedTitle: movie.title.toLowerCase(),
          year: movie.year,
          url: `https://movies.example.test/${String(index)}`,
          tmdbId: 1000 + index,
        }),
      );
    }
    return ids;
  });
}

async function setup(movieCount = 12) {
  const t = createTestBackend();
  const memberId = await seedUser(t, MEMBER);
  const otherId = await seedUser(t, OTHER);
  const adminId = await seedUser(t, ADMIN, true);
  await advanceToS3(t);
  const movieIds = await seedMovies(
    t,
    Array.from({ length: movieCount }, (_, index) => ({
      title: `Movie ${String(index + 1).padStart(2, "0")}`,
      year: 2026,
    })),
  );
  const member = t.withIdentity(MEMBER);
  return { t, member, memberId, otherId, adminId, movieIds };
}

function movieAt(ids: Array<Id<"movies">>, index: number): Id<"movies"> {
  const id = ids.at(index);
  if (id === undefined) throw new Error(`Missing movie ${String(index)}`);
  return id;
}

async function scoreMovie(
  client: ReturnType<TestBackend["withIdentity"]>,
  year: number,
  movieId: Id<"movies">,
  scores: Partial<Record<ScorecardCriterion, number>>,
) {
  for (const [criterion, value] of Object.entries(scores)) {
    await client.mutation(api.scorecard.mine.setScore, {
      clientApiVersion: V,
      year,
      movieId,
      criterion: criterion as ScorecardCriterion,
      value,
    });
  }
}

async function insertMovieListType(
  t: TestBackend,
  maxItems: number,
  targetType: "MOVIE" | "SHOW" = "MOVIE",
): Promise<Id<"rankedListTypes">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("rankedListTypes", {
      name: `${targetType} ${String(maxItems)}`,
      maxItems,
      targetType,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

describe("scorecard leaderboard (pure)", () => {
  function candidate(
    id: string,
    title: string,
    scores: ScorecardScores,
    extra: Partial<LeaderboardCandidate> = {},
  ): LeaderboardCandidate {
    return { id, title, scores, unseen: false, ...extra };
  }

  test("sum, completeness and average need all 9 criteria", () => {
    // protects=complete/average rule; fails_when=an 8-of-9 entry gets an average; no_claim=none beyond protects
    const full = scoresWithSum(75);
    expect(isComplete(full)).toBe(true);
    expect(entrySum(full)).toBe(75);
    expect(entryAverage(full)).toBeCloseTo(8.3333, 4);
    const partial: ScorecardScores = { ...full };
    delete partial.replay;
    expect(isComplete(partial)).toBe(false);
    expect(entrySum(partial)).toBeNull();
    expect(entryAverage(partial)).toBeNull();
  });

  test("orders by sum, then tie order, then title, and flags ties", () => {
    // protects=leaderboard order and tied flag; fails_when=equal sums lose title order or tieOrder is ignored; no_claim=none beyond protects
    const placements = rankEntries([
      candidate("a", "Zeta", scoresWithSum(75)),
      candidate("b", "Alpha", scoresWithSum(75)),
      candidate("c", "Mid", scoresWithSum(72)),
      candidate("d", "Unseen", scoresWithSum(90), { unseen: true }),
      candidate("e", "Partial", { story: 10 }),
    ]);
    expect(placements.map((p) => [p.entry.id, p.position, p.tied])).toEqual([
      ["b", 1, true],
      ["a", 2, true],
      ["c", 3, false],
    ]);
    const reordered = rankEntries([
      candidate("a", "Zeta", scoresWithSum(75), { tieOrder: 1 }),
      candidate("b", "Alpha", scoresWithSum(75), { tieOrder: 2 }),
    ]);
    expect(reordered.map((p) => p.entry.id)).toEqual(["a", "b"]);
    const partlyOrdered = rankEntries([
      candidate("a", "Alpha", scoresWithSum(75)),
      candidate("b", "Zeta", scoresWithSum(75), { tieOrder: 1 }),
    ]);
    expect(partlyOrdered.map((p) => p.entry.id)).toEqual(["b", "a"]);
  });
});

describe("scorecard API", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("requires sign-in and keeps entries owner-only, even from admins", async () => {
    // protects=owner isolation; fails_when=another user or an admin sees member scores; no_claim=impersonation covered separately
    const { t, member, movieIds } = await setup();
    await expectDomainError(
      t.query(api.scorecard.mine.listForYear, { year: 2026 }),
      "AUTHENTICATION_REQUIRED",
    );
    await scoreMovie(member, 2026, movieAt(movieIds, 0), { story: 9 });
    expect(
      await member.query(api.scorecard.mine.listForYear, { year: 2026 }),
    ).toHaveLength(1);
    expect(
      await t
        .withIdentity(OTHER)
        .query(api.scorecard.mine.listForYear, { year: 2026 }),
    ).toEqual([]);
    expect(
      await t
        .withIdentity(ADMIN)
        .query(api.scorecard.mine.listForYear, { year: 2026 }),
    ).toEqual([]);
  });

  test("refuses every endpoint while an admin impersonates the owner", async () => {
    // protects=impersonation guard; fails_when=an impersonating admin reads or writes the target's scorecard; no_claim=none beyond protects
    const { t, member, memberId, adminId, movieIds } = await setup();
    const movieId = movieAt(movieIds, 0);
    await scoreMovie(member, 2026, movieId, { story: 9 });
    await t.run(async (ctx) => {
      await ctx.db.insert("impersonationSessions", {
        actorUserId: adminId,
        targetUserId: memberId,
        reason: "Support investigation",
        startedAt: Date.now() - 1_000,
        endsAt: Date.now() + 3_600_000,
      });
    });
    const admin = t.withIdentity(ADMIN);
    const base = { clientApiVersion: V, year: 2026, movieId };
    await expectDomainError(
      admin.query(api.scorecard.mine.listForYear, { year: 2026 }),
      "FORBIDDEN",
    );
    await expectDomainError(
      admin.mutation(api.scorecard.mine.setScore, {
        ...base,
        criterion: "story",
        value: 1,
      }),
      "FORBIDDEN",
    );
    await expectDomainError(
      admin.mutation(api.scorecard.mine.add, base),
      "FORBIDDEN",
    );
    await expectDomainError(
      admin.mutation(api.scorecard.mine.setUnseen, { ...base, unseen: true }),
      "FORBIDDEN",
    );
    await expectDomainError(
      admin.mutation(api.scorecard.mine.clear, base),
      "FORBIDDEN",
    );
    await expectDomainError(
      admin.mutation(api.scorecard.mine.orderTie, {
        clientApiVersion: V,
        year: 2026,
        movieIds: [movieId, movieAt(movieIds, 1)],
      }),
      "FORBIDDEN",
    );
    const typeId = await insertMovieListType(t, 10);
    await expectDomainError(
      admin.mutation(api.scorecard.mine.applyToRankedList, {
        clientApiVersion: V,
        year: 2026,
        target: { kind: "create", rankedListTypeId: typeId, title: "x" },
        expectedMovieIds: [],
      }),
      "FORBIDDEN",
    );
    const stored = await t.run(async (ctx) =>
      ctx.db.query("scorecardEntries").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.story).toBe(9);
  });

  test("rejects invalid scores, criteria and years without saving", async () => {
    // protects=score validation; fails_when=0, 11, 7.5 or NaN is stored; no_claim=criterion union is enforced by the Convex validator
    const { t, member, movieIds } = await setup();
    const movieId = movieAt(movieIds, 0);
    for (const value of [0, 11, 7.5, Number.NaN]) {
      await expectDomainError(
        member.mutation(api.scorecard.mine.setScore, {
          clientApiVersion: V,
          year: 2026,
          movieId,
          criterion: "story",
          value,
        }),
        "VALIDATION_FAILED",
      );
    }
    await expect(
      member.mutation(api.scorecard.mine.setScore, {
        clientApiVersion: V,
        year: 2026,
        movieId,
        criterion: "plot" as ScorecardCriterion,
        value: 5,
      }),
    ).rejects.toThrow();
    await expectDomainError(
      member.query(api.scorecard.mine.listForYear, { year: 2026.5 }),
      "VALIDATION_FAILED",
    );
    expect(
      await t.run(async (ctx) => ctx.db.query("scorecardEntries").collect()),
    ).toEqual([]);
  });

  test("becomes complete and gets a position only after the 9th score", async () => {
    // protects=complete/position contract; fails_when=8-of-9 entry is ranked; no_claim=none beyond protects
    const { member, movieIds } = await setup();
    const movieId = movieAt(movieIds, 0);
    const scores = scoresWithSum(75);
    const { replay, ...eight } = scores;
    await scoreMovie(member, 2026, movieId, eight);
    const [entry] = await member.query(api.scorecard.mine.listForYear, {
      year: 2026,
    });
    expect(entry).toMatchObject({
      complete: false,
      average: null,
      position: null,
      tied: false,
    });
    const last = await member.mutation(api.scorecard.mine.setScore, {
      clientApiVersion: V,
      year: 2026,
      movieId,
      criterion: "replay",
      value: replay,
    });
    expect(last.complete).toBe(true);
    expect(last.position).toBe(1);
    expect(last.average).toBeCloseTo(75 / 9, 6);
    expect(
      await member.query(api.scorecard.mine.listForYear, { year: 2026 }),
    ).toEqual([expect.objectContaining({ scores })]);
  });

  test("orders ties by title until ordered; a later score clears the tie order", async () => {
    // protects=tie ordering and invalidation; fails_when=tieOrder survives a score change or ordering ignores it; no_claim=none beyond protects
    const { member, movieIds } = await setup();
    const m1 = movieAt(movieIds, 0);
    const m2 = movieAt(movieIds, 1);
    const m3 = movieAt(movieIds, 2);
    await scoreMovie(member, 2026, m2, scoresWithSum(75));
    await scoreMovie(member, 2026, m1, scoresWithSum(75));
    await scoreMovie(member, 2026, m3, scoresWithSum(72));
    const titles = async () =>
      (await member.query(api.scorecard.mine.listForYear, { year: 2026 }))
        .filter((entry) => entry.position !== null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((entry) => [entry.movie.title, entry.tied]);
    expect(await titles()).toEqual([
      ["Movie 01", true],
      ["Movie 02", true],
      ["Movie 03", false],
    ]);
    await member.mutation(api.scorecard.mine.orderTie, {
      clientApiVersion: V,
      year: 2026,
      movieIds: [m2, m1],
    });
    expect((await titles()).map(([title]) => title)).toEqual([
      "Movie 02",
      "Movie 01",
      "Movie 03",
    ]);
    // Re-saving the same value on Movie 02 still clears its tie order.
    await member.mutation(api.scorecard.mine.setScore, {
      clientApiVersion: V,
      year: 2026,
      movieId: m2,
      criterion: "story",
      value: scoresWithSum(75).story,
    });
    expect((await titles()).map(([title]) => title)).toEqual([
      "Movie 01",
      "Movie 02",
      "Movie 03",
    ]);
  });

  test("orderTie requires exactly the whole tied group", async () => {
    // protects=orderTie validation; fails_when=a subset, duplicate or outsider is accepted; no_claim=none beyond protects
    const { t, member, movieIds } = await setup();
    const ids = [0, 1, 2, 3].map((i) => movieAt(movieIds, i));
    for (const id of ids.slice(0, 3)) {
      await scoreMovie(member, 2026, id, scoresWithSum(75));
    }
    await scoreMovie(member, 2026, movieAt(ids, 3), scoresWithSum(70));
    const order = (list: Array<Id<"movies">>) =>
      member.mutation(api.scorecard.mine.orderTie, {
        clientApiVersion: V,
        year: 2026,
        movieIds: list,
      });
    await expectDomainError(order(ids.slice(0, 2)), "VALIDATION_FAILED");
    await expectDomainError(
      order([movieAt(ids, 0), movieAt(ids, 0), movieAt(ids, 1)]),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      order([movieAt(ids, 0), movieAt(ids, 1), movieAt(ids, 3)]),
      "VALIDATION_FAILED",
    );
    const result = await order([
      movieAt(ids, 2),
      movieAt(ids, 0),
      movieAt(ids, 1),
    ]);
    expect(result.map((entry) => entry.movie.id)).toEqual([
      movieAt(ids, 2),
      movieAt(ids, 0),
      movieAt(ids, 1),
    ]);
    const tieOrders = await t.run(async (ctx) =>
      (await ctx.db.query("scorecardEntries").collect()).map((row) => [
        row.movieId,
        row.tieOrder ?? null,
      ]),
    );
    expect(tieOrders).toEqual(
      expect.arrayContaining([
        [movieAt(ids, 2), 1],
        [movieAt(ids, 0), 2],
        [movieAt(ids, 1), 3],
        [movieAt(ids, 3), null],
      ]),
    );
  });

  test("add, setUnseen and setScore enforce the ±1 year window and are idempotent", async () => {
    // protects=year window and single entry per movie-year; fails_when=a 2-year-off movie is stored or add duplicates; no_claim=none beyond protects
    const { t, member } = await setup(0);
    const movie2024 = movieAt(
      await seedMovies(t, [{ title: "Old", year: 2024 }]),
      0,
    );
    for (const year of [2023, 2024, 2025]) {
      const first = await member.mutation(api.scorecard.mine.add, {
        clientApiVersion: V,
        year,
        movieId: movie2024,
      });
      const second = await member.mutation(api.scorecard.mine.add, {
        clientApiVersion: V,
        year,
        movieId: movie2024,
      });
      expect(second.id).toBe(first.id);
    }
    for (const year of [2022, 2026]) {
      const base = { clientApiVersion: V, year, movieId: movie2024 };
      await expectDomainError(
        member.mutation(api.scorecard.mine.add, base),
        "VALIDATION_FAILED",
        { scorecardYear: year, movieYear: 2024 },
      );
      await expectDomainError(
        member.mutation(api.scorecard.mine.setUnseen, { ...base, unseen: true }),
        "VALIDATION_FAILED",
      );
      await expectDomainError(
        member.mutation(api.scorecard.mine.setScore, {
          ...base,
          criterion: "fun",
          value: 5,
        }),
        "VALIDATION_FAILED",
      );
    }
    expect(
      await t.run(async (ctx) => ctx.db.query("scorecardEntries").collect()),
    ).toHaveLength(3);
  });

  test("caps a year at 200 entries without affecting other years", async () => {
    // protects=per-year capacity; fails_when=a 201st entry is created or other years count; no_claim=none beyond protects
    const { t, member, memberId } = await setup(0);
    const ids = await seedMovies(
      t,
      Array.from({ length: 201 }, (_, i) => ({
        title: `Bulk ${String(i)}`,
        year: 2026,
      })),
    );
    await t.run(async (ctx) => {
      for (const movieId of ids.slice(0, 200)) {
        await ctx.db.insert("scorecardEntries", {
          userId: memberId,
          year: 2026,
          movieId,
          unseen: false,
          createdAt: 1,
          updatedAt: 1,
        });
      }
    });
    await expectDomainError(
      member.mutation(api.scorecard.mine.add, {
        clientApiVersion: V,
        year: 2026,
        movieId: movieAt(ids, 200),
      }),
      "CONFLICT",
      { limit: 200 },
    );
    await expect(
      member.mutation(api.scorecard.mine.add, {
        clientApiVersion: V,
        year: 2025,
        movieId: movieAt(ids, 200),
      }),
    ).resolves.toMatchObject({ year: 2025 });
  });

  test("unseen hides a movie from the leaderboard; clear deletes the entry", async () => {
    // protects=unseen and clear semantics; fails_when=unseen movie is ranked or clear leaves a row; no_claim=none beyond protects
    const { t, member, movieIds } = await setup();
    const movieId = movieAt(movieIds, 0);
    await scoreMovie(member, 2026, movieId, scoresWithSum(80));
    const unseen = await member.mutation(api.scorecard.mine.setUnseen, {
      clientApiVersion: V,
      year: 2026,
      movieId,
      unseen: true,
    });
    expect(unseen).toMatchObject({ unseen: true, position: null, complete: true });
    const restored = await member.mutation(api.scorecard.mine.setUnseen, {
      clientApiVersion: V,
      year: 2026,
      movieId,
      unseen: false,
    });
    expect(restored.position).toBe(1);
    await expect(
      member.mutation(api.scorecard.mine.clear, {
        clientApiVersion: V,
        year: 2026,
        movieId,
      }),
    ).resolves.toEqual({ movieId });
    await expect(
      member.mutation(api.scorecard.mine.clear, {
        clientApiVersion: V,
        year: 2026,
        movieId,
      }),
    ).resolves.toEqual({ movieId });
    expect(
      await t.run(async (ctx) => ctx.db.query("scorecardEntries").collect()),
    ).toEqual([]);
  });

  test("returns the owner's latest BBPC rating for the movie", async () => {
    // protects=myRating hydration; fails_when=another user's or an older rating is shown; no_claim=none beyond protects
    const { t, member, memberId, otherId, movieIds } = await setup();
    const movieId = movieAt(movieIds, 0);
    await t.run(async (ctx) => {
      const low = await ctx.db.insert("ratings", { name: "Meh", value: 2 });
      const high = await ctx.db.insert("ratings", {
        name: "Banger",
        value: 5,
        icon: "fire",
      });
      await ctx.db.insert("reviews", { userId: otherId, movieId, ratingId: low });
      await ctx.db.insert("reviews", { userId: memberId, movieId, ratingId: low });
      await ctx.db.insert("reviews", { userId: memberId, movieId, ratingId: high });
    });
    const entry = await member.mutation(api.scorecard.mine.add, {
      clientApiVersion: V,
      year: 2026,
      movieId,
    });
    expect(entry.myRating).toEqual({ name: "Banger", value: 5, icon: "fire" });
  });

  describe("applyToRankedList", () => {
    async function scoreDescending(
      member: ReturnType<TestBackend["withIdentity"]>,
      movieIds: Array<Id<"movies">>,
      count: number,
    ) {
      for (let i = 0; i < count; i += 1) {
        await scoreMovie(member, 2026, movieAt(movieIds, i), scoresWithSum(90 - i));
      }
      return movieIds.slice(0, count);
    }

    test("replaces an existing list with the top 10, keeps status, audits the count", async () => {
      // protects=atomic replace; fails_when=old items survive, ranks are wrong or status changes; no_claim=none beyond protects
      const { t, member, memberId, movieIds } = await setup(12);
      const ordered = await scoreDescending(member, movieIds, 12);
      const typeId = await insertMovieListType(t, 10);
      const listId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("rankedLists", {
          userId: memberId,
          rankedListTypeId: typeId,
          status: "PUBLISHED",
          title: "2026 Top 10",
          createdAt: 1,
          updatedAt: 1,
        });
        for (const [rank, index] of [[1, 11], [2, 10], [3, 9]] as const) {
          await ctx.db.insert("rankedItems", {
            rankedListId: id,
            targetType: "movie",
            movieId: movieAt(movieIds, index),
            rank,
            createdAt: 1,
            updatedAt: 1,
          });
        }
        return id;
      });
      const top = ordered.slice(0, 10);
      const result = await member.mutation(api.scorecard.mine.applyToRankedList, {
        clientApiVersion: V,
        year: 2026,
        target: { kind: "existing", rankedListId: listId },
        expectedMovieIds: top,
      });
      expect(result.status).toBe("PUBLISHED");
      expect(result.items.map((item) => [item.rank, item.movieId])).toEqual(
        top.map((movieId, index) => [index + 1, movieId]),
      );
      const audits = await t.run(async (ctx) =>
        (await ctx.db.query("auditEvents").collect()).filter(
          (event) => event.action === "rankings.user.listReplacedFromScorecard",
        ),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0]?.metadata).toEqual({ itemCount: 10 });
    });

    test("respects a smaller maxItems and fewer ranked movies; refuses an empty leaderboard", async () => {
      // protects=N=min(10,maxItems,ranked); fails_when=extra items are written or an empty list is applied; no_claim=none beyond protects
      const { t, member, movieIds } = await setup(12);
      const ordered = await scoreDescending(member, movieIds, 12);
      const fiveType = await insertMovieListType(t, 5);
      const five = await member.mutation(api.scorecard.mine.applyToRankedList, {
        clientApiVersion: V,
        year: 2026,
        target: { kind: "create", rankedListTypeId: fiveType, title: "Top 5" },
        expectedMovieIds: ordered.slice(0, 5),
      });
      expect(five.items).toHaveLength(5);
      expect(five.status).toBe("DRAFT");
      expect(five.title).toBe("Top 5");

      const fresh = await setup(4);
      const fewer = await scoreDescending(fresh.member, fresh.movieIds, 4);
      const tenType = await insertMovieListType(fresh.t, 10);
      const four = await fresh.member.mutation(
        api.scorecard.mine.applyToRankedList,
        {
          clientApiVersion: V,
          year: 2026,
          target: { kind: "create", rankedListTypeId: tenType, title: "2026" },
          expectedMovieIds: fewer,
        },
      );
      expect(four.items).toHaveLength(4);
      await expectDomainError(
        fresh.member.mutation(api.scorecard.mine.applyToRankedList, {
          clientApiVersion: V,
          year: 2025,
          target: { kind: "create", rankedListTypeId: tenType, title: "2025" },
          expectedMovieIds: [],
        }),
        "VALIDATION_FAILED",
      );
    });

    test("rejects a stale expectation, a show list, and another user's list (even for admins)", async () => {
      // protects=stale/ownership/type guards; fails_when=a list changes on stale input or a foreign list is written; no_claim=none beyond protects
      const { t, member, otherId, movieIds } = await setup(3);
      const ordered = await scoreDescending(member, movieIds, 3);
      const typeId = await insertMovieListType(t, 10);
      const showType = await insertMovieListType(t, 10, "SHOW");
      const foreignList = await t.run(async (ctx) =>
        ctx.db.insert("rankedLists", {
          userId: otherId,
          rankedListTypeId: typeId,
          status: "DRAFT",
          createdAt: 1,
          updatedAt: 1,
        }),
      );
      await expectDomainError(
        member.mutation(api.scorecard.mine.applyToRankedList, {
          clientApiVersion: V,
          year: 2026,
          target: { kind: "create", rankedListTypeId: typeId, title: "x" },
          expectedMovieIds: [...ordered].reverse(),
        }),
        "CONFLICT",
      );
      await expectDomainError(
        member.mutation(api.scorecard.mine.applyToRankedList, {
          clientApiVersion: V,
          year: 2026,
          target: { kind: "create", rankedListTypeId: showType, title: "x" },
          expectedMovieIds: ordered,
        }),
        "VALIDATION_FAILED",
      );
      for (const client of [member, t.withIdentity(ADMIN)]) {
        await expectDomainError(
          client.mutation(api.scorecard.mine.applyToRankedList, {
            clientApiVersion: V,
            year: 2026,
            target: { kind: "existing", rankedListId: foreignList },
            expectedMovieIds: ordered,
          }),
          "FORBIDDEN",
        );
      }
      const lists = await t.run(async (ctx) => ctx.db.query("rankedLists").collect());
      expect(lists).toHaveLength(1);
      expect(
        await t.run(async (ctx) => ctx.db.query("rankedItems").collect()),
      ).toEqual([]);
    });
  });

  test("admin movie delete is blocked by a scorecard entry without naming the owner", async () => {
    // protects=delete guard privacy; fails_when=the movie is deleted or the error carries a user id; no_claim=none beyond protects
    const { t, member, movieIds } = await setup(1);
    const movieId = movieAt(movieIds, 0);
    await member.mutation(api.scorecard.mine.add, {
      clientApiVersion: V,
      year: 2026,
      movieId,
    });
    try {
      await t
        .withIdentity(ADMIN)
        .mutation(api.catalog.admin.deleteMovie, { clientApiVersion: V, id: movieId });
      throw new Error("expected deleteMovie to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConvexError);
      if (!(error instanceof ConvexError)) throw error;
      expect(error.data).toMatchObject({
        code: "CONFLICT",
        details: { relationship: "private scorecard entry" },
      });
      const data = error.data as { details?: Record<string, unknown> };
      expect(Object.keys(data.details ?? {})).toEqual(["relationship"]);
    }
    expect(await t.run(async (ctx) => ctx.db.get("movies", movieId))).not.toBeNull();
  });
});

describe("staging movie merge", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function mergeSetup(collide: boolean) {
    vi.stubEnv("BBPC_ENVIRONMENT", "staging");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://merry-shepherd-928.convex.cloud");
    const t = createTestBackend();
    const seeded = await t.run(async (ctx) => {
      await ctx.db.insert("systemState", {
        singletonKey: "global",
        cutoverStage: "S4",
        applicationWriteMode: "enabled",
        cutoverRunId: "merge-test",
        apiVersion: BBPC_API_VERSION,
        initializedAt: 1,
        updatedAt: 1,
        updatedBy: "test",
        firstApplicationWriteAt: 1,
      });
      const value = {
        title: "Dup",
        normalizedTitle: "dup",
        year: 2026,
        tmdbId: 77,
        url: "https://www.imdb.com/title/tt0000077",
      };
      const survivorId = await ctx.db.insert("movies", value);
      const sourceId = await ctx.db.insert("movies", value);
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("scorecardEntries", {
        userId,
        year: 2026,
        movieId: sourceId,
        story: 9,
        unseen: false,
        createdAt: 1,
        updatedAt: 1,
      });
      if (collide) {
        await ctx.db.insert("scorecardEntries", {
          userId,
          year: 2026,
          movieId: survivorId,
          unseen: false,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      return { survivorId, sourceId };
    });
    const fingerprint = await t.run(async (ctx) =>
      catalogSnapshotFingerprint([
        ...(await ctx.db.query("movies").collect()),
        ...(await ctx.db.query("scorecardEntries").collect()),
      ]),
    );
    const args = {
      cutoverRunId: "merge-test",
      clientApiVersion: BBPC_API_VERSION,
      batchId: "merge-test",
      tmdbId: 77,
      movieIds: [seeded.survivorId, seeded.sourceId],
      survivorId: seeded.survivorId,
      newUrl: "https://www.imdb.com/title/tt0000077/",
      expectedFingerprint: fingerprint,
    };
    return { t, args, ...seeded };
  }

  test("moves scorecard entries to the surviving movie", async () => {
    // protects=merge moves scorecard refs; fails_when=entry is orphaned or merge throws on scorecard rows; no_claim=fingerprint order mirrors movieReferences
    const { t, args, survivorId } = await mergeSetup(false);
    await expect(
      t.mutation(internal.catalog.operations.mergeStagingMovies, args),
    ).resolves.toEqual({ deleted: 1, movedReferences: 1 });
    const entries = await t.run(async (ctx) =>
      ctx.db.query("scorecardEntries").collect(),
    );
    expect(entries.map((entry) => [entry.movieId, entry.story])).toEqual([
      [survivorId, 9],
    ]);
  });

  test("rejects a merge when one user scored both duplicates in the same year", async () => {
    // protects=collision rejection; fails_when=one of the user's entries is silently dropped; no_claim=none beyond protects
    const { t, args } = await mergeSetup(true);
    await expect(
      t.mutation(internal.catalog.operations.mergeStagingMovies, args),
    ).rejects.toThrow(/collide/);
    expect(
      await t.run(async (ctx) => ctx.db.query("scorecardEntries").collect()),
    ).toHaveLength(2);
  });
});
