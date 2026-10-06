/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  MAX_QUOTE_SUBMISSIONS_PER_SEASON,
  MAX_SEASONS_TO_INSPECT,
} from "./games/limits.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const TODAY = "2026-07-24";
const NOW = Date.UTC(2026, 6, 24, 12);

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function expectConflict(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: "CONFLICT" });
    return;
  }
  throw new Error("Expected a CONFLICT domain error");
}

async function seedUser(
  t: TestBackend,
  name: string | null,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      ...(name === null ? {} : { name }),
      email: "listener@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function seedSeasons(t: TestBackend) {
  return await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Quotabunga",
      lookupId: "quotabunga",
      normalizedLookupId: "quotabunga",
    });
    const currentSeasonId = await ctx.db.insert("seasons", {
      title: "Season 3",
      gameTypeId,
      startedOn: "2026-07-01",
    });
    const pastSeasonId = await ctx.db.insert("seasons", {
      title: "Season 2",
      gameTypeId,
      startedOn: "2026-01-01",
      endedOn: "2026-06-30",
    });
    const quietSeasonId = await ctx.db.insert("seasons", {
      title: "Season 1",
      gameTypeId,
      startedOn: "2025-07-01",
      endedOn: "2025-12-31",
    });
    return { currentSeasonId, pastSeasonId, quietSeasonId };
  });
}

async function seedEpisode(
  t: TestBackend,
  input: {
    number: number;
    status: string;
    slug?: string;
    date?: string;
    predictionClosesAt?: number;
  },
): Promise<Id<"episodes">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("episodes", {
      title: `Episode ${String(input.number)}`,
      ...input,
    });
  });
}

async function insertQuote(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    episodeId: Id<"episodes">;
    seasonId: Id<"seasons">;
    quoteText: string;
    status?: "SUBMITTED" | "INCLUDED" | "REJECTED";
    bracketOrder?: number;
    placement?: number;
    createdAt?: number;
    clipUrl?: string;
    clipStartSeconds?: number;
    clipEndSeconds?: number;
  },
): Promise<Id<"quoteSubmissions">> {
  const { status, createdAt, ...rest } = input;
  return await t.run(async (ctx) => {
    return await ctx.db.insert("quoteSubmissions", {
      ...rest,
      sourceTitle: "Synthetic source",
      sourceType: "MOVIE",
      status: status ?? "SUBMITTED",
      listenerNotes: "Private listener note",
      adminNotes: "Private admin note",
      createdAt: createdAt ?? 1,
      updatedAt: createdAt ?? 1,
    });
  });
}

describe("Quotabunga public archive", () => {
  test("lists seasons with quotes plus the current season, newest first", async () => {
    const t = createTestBackend();
    const { currentSeasonId, pastSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Listener");
    const episodeId = await seedEpisode(t, { number: 5, status: "published" });
    await insertQuote(t, {
      userId,
      episodeId,
      seasonId: pastSeasonId,
      quoteText: "Past quote",
    });

    expect(
      await t.query(api.games.public.quotabungaSeasons, { today: TODAY }),
    ).toEqual([
      {
        id: currentSeasonId,
        title: "Season 3",
        startedOn: "2026-07-01",
        endedOn: null,
        isCurrent: true,
      },
      {
        id: pastSeasonId,
        title: "Season 2",
        startedOn: "2026-01-01",
        endedOn: "2026-06-30",
        isCurrent: false,
      },
    ]);
  });

  test("shows a published, awarded round in full and keeps private fields out", async () => {
    const t = createTestBackend();
    const { pastSeasonId } = await seedSeasons(t);
    const [winner, runnerUp, unnamed, rejected] = await Promise.all([
      seedUser(t, "Winner"),
      seedUser(t, "Runner Up"),
      seedUser(t, null),
      seedUser(t, "Rejected"),
    ]);
    const episodeId = await seedEpisode(t, {
      number: 5,
      status: "published",
      slug: "episode-5",
      date: "2026-03-01",
    });
    const base = { episodeId, seasonId: pastSeasonId };
    await insertQuote(t, {
      ...base,
      userId: unnamed,
      quoteText: "Left out of the bracket",
      createdAt: 4,
    });
    await insertQuote(t, {
      ...base,
      userId: runnerUp,
      quoteText: "Second place",
      status: "INCLUDED",
      bracketOrder: 1,
      placement: 2,
    });
    const winningId = await insertQuote(t, {
      ...base,
      userId: winner,
      quoteText: "First place",
      status: "INCLUDED",
      bracketOrder: 2,
      placement: 1,
      clipUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      clipStartSeconds: 12.5,
      clipEndSeconds: 18,
    });
    await insertQuote(t, {
      ...base,
      userId: winner,
      quoteText: "Bracket entry without a place",
      status: "INCLUDED",
      bracketOrder: 3,
      // A legacy row with an out-of-range place reads as unplaced.
      placement: 4,
    });
    await insertQuote(t, {
      ...base,
      userId: rejected,
      quoteText: "Rejected quote",
      status: "REJECTED",
    });

    const detail = await t.query(api.games.public.quotabungaSeason, {
      seasonId: pastSeasonId,
      today: TODAY,
      now: NOW,
    });

    expect(detail?.season).toMatchObject({ id: pastSeasonId, isCurrent: false });
    expect(detail?.rounds).toHaveLength(1);
    const round = detail?.rounds[0];
    expect(round).toMatchObject({
      episode: {
        id: episodeId,
        number: 5,
        title: "Episode 5",
        date: "2026-03-01",
        slug: "episode-5",
      },
      state: "revealed",
      entryCount: 4,
    });
    expect(
      round?.entries.map((entry) => [
        entry.quoteText,
        entry.placement,
        entry.inBracket,
        entry.user.name,
      ]),
    ).toEqual([
      ["First place", 1, true, "Winner"],
      ["Second place", 2, true, "Runner Up"],
      ["Bracket entry without a place", null, true, "Winner"],
      ["Left out of the bracket", null, false, null],
    ]);
    expect(round?.entries[0]).toEqual({
      id: winningId,
      quoteText: "First place",
      sourceTitle: "Synthetic source",
      sourceType: "MOVIE",
      clipUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      clipStartSeconds: 12.5,
      clipEndSeconds: 18,
      inBracket: true,
      placement: 1,
      user: { id: winner, name: "Winner" },
    });
    expect(JSON.stringify(detail)).not.toMatch(/Rejected|Private/u);
    expect(detail?.listeners).toEqual([
      { user: { id: winner, name: "Winner" }, wins: 1, points: 40, entryCount: 2 },
      {
        user: { id: runnerUp, name: "Runner Up" },
        wins: 0,
        points: 20,
        entryCount: 1,
      },
      { user: { id: unnamed, name: null }, wins: 0, points: 0, entryCount: 1 },
    ]);
  });

  test("reports only a count until a round is awarded and its episode published", async () => {
    const t = createTestBackend();
    const { currentSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Secret Listener");
    const openEpisodeId = await seedEpisode(t, { number: 9, status: "next" });
    const graceEpisodeId = await seedEpisode(t, {
      number: 8,
      status: "recording",
      predictionClosesAt: NOW + 1,
    });
    const lockedEpisodeId = await seedEpisode(t, {
      number: 7,
      status: "recording",
      slug: "episode-7",
      predictionClosesAt: NOW - 1,
    });
    const rejectedOnlyEpisodeId = await seedEpisode(t, {
      number: 6,
      status: "published",
    });
    // Awarded at the recording, but the episode is not out yet.
    const awardedEpisodeId = await seedEpisode(t, {
      number: 5,
      status: "recording",
      slug: "episode-5",
      predictionClosesAt: NOW - 1,
    });
    await insertQuote(t, {
      userId,
      episodeId: awardedEpisodeId,
      seasonId: currentSeasonId,
      quoteText: "Secret winning quote",
      status: "INCLUDED",
      placement: 1,
    });
    for (const episodeId of [openEpisodeId, graceEpisodeId, lockedEpisodeId]) {
      await insertQuote(t, {
        userId,
        episodeId,
        seasonId: currentSeasonId,
        quoteText: "Secret quote",
      });
    }
    await insertQuote(t, {
      userId,
      episodeId: lockedEpisodeId,
      seasonId: currentSeasonId,
      quoteText: "Secret rejected quote",
      status: "REJECTED",
    });
    await insertQuote(t, {
      userId,
      episodeId: rejectedOnlyEpisodeId,
      seasonId: currentSeasonId,
      quoteText: "Secret rejected quote",
      status: "REJECTED",
    });

    const detail = await t.query(api.games.public.quotabungaSeason, {
      seasonId: currentSeasonId,
      today: TODAY,
      now: NOW,
    });

    expect(detail?.season.isCurrent).toBe(true);
    expect(
      detail?.rounds.map((round) => [
        round.episode.number,
        round.state,
        round.entryCount,
        round.entries,
        round.episode.slug,
      ]),
    ).toEqual([
      [9, "open", 1, [], null],
      [8, "open", 1, [], null],
      // The rejected entry still counts until the reveal, so the number
      // does not move when the hosts cut one.
      [7, "locked", 2, [], null],
      [5, "locked", 1, [], null],
    ]);
    expect(detail?.listeners).toEqual([]);
    expect(JSON.stringify(detail)).not.toMatch(/Secret/u);
  });

  test("adds the empty open round to the current season only", async () => {
    const t = createTestBackend();
    const { currentSeasonId, pastSeasonId } = await seedSeasons(t);
    const openEpisodeId = await seedEpisode(t, { number: 9, status: "next" });
    const args = { today: TODAY, now: NOW };

    const current = await t.query(api.games.public.quotabungaSeason, {
      seasonId: currentSeasonId,
      ...args,
    });
    expect(current?.rounds).toEqual([
      {
        episode: {
          id: openEpisodeId,
          number: 9,
          title: "Episode 9",
          date: null,
          slug: null,
        },
        state: "open",
        entryCount: 0,
        entries: [],
      },
    ]);
    const past = await t.query(api.games.public.quotabungaSeason, {
      seasonId: pastSeasonId,
      ...args,
    });
    expect(past?.rounds).toEqual([]);

    // Entries filed under another season keep the round out of this one.
    const userId = await seedUser(t, "Listener");
    await insertQuote(t, {
      userId,
      episodeId: openEpisodeId,
      seasonId: pastSeasonId,
      quoteText: "Filed elsewhere",
    });
    const afterEntry = await t.query(api.games.public.quotabungaSeason, {
      seasonId: currentSeasonId,
      ...args,
    });
    expect(afterEntry?.rounds).toEqual([]);
  });

  test("leaves out an active round that no longer accepts entries", async () => {
    const t = createTestBackend();
    const { currentSeasonId } = await seedSeasons(t);
    await seedEpisode(t, {
      number: 9,
      status: "recording",
      predictionClosesAt: NOW - 1,
    });

    const detail = await t.query(api.games.public.quotabungaSeason, {
      seasonId: currentSeasonId,
      today: TODAY,
      now: NOW,
    });
    expect(detail?.rounds).toEqual([]);
  });

  test("shows a published round the hosts never awarded, without places", async () => {
    const t = createTestBackend();
    const { pastSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Listener");
    const unawardedEpisodeId = await seedEpisode(t, {
      number: 6,
      status: "published",
      slug: "episode-6",
    });
    // The legacy title-case status is published too, and has no page slug.
    const awardedEpisodeId = await seedEpisode(t, {
      number: 5,
      status: "Published",
    });
    await insertQuote(t, {
      userId,
      episodeId: unawardedEpisodeId,
      seasonId: pastSeasonId,
      quoteText: "Unawarded quote",
      status: "INCLUDED",
      bracketOrder: 1,
    });
    await insertQuote(t, {
      userId,
      episodeId: awardedEpisodeId,
      seasonId: pastSeasonId,
      quoteText: "Third place",
      status: "INCLUDED",
      placement: 3,
    });

    const detail = await t.query(api.games.public.quotabungaSeason, {
      seasonId: pastSeasonId,
      today: TODAY,
      now: NOW,
    });

    expect(
      detail?.rounds.map((round) => [
        round.episode.number,
        round.state,
        round.entryCount,
        round.entries.map((entry) => entry.quoteText),
        round.episode.slug,
      ]),
    ).toEqual([
      [6, "revealed", 1, ["Unawarded quote"], "episode-6"],
      [5, "revealed", 1, ["Third place"], null],
    ]);
    expect(detail?.rounds[0]?.entries[0]?.placement).toBeNull();
    // Both entries count for the listener; only the placed one scores.
    expect(detail?.listeners).toEqual([
      {
        user: { id: userId, name: "Listener" },
        wins: 0,
        points: 10,
        entryCount: 2,
      },
    ]);
  });

  test("tallies listeners across revealed rounds and orders ties", async () => {
    const t = createTestBackend();
    const { pastSeasonId } = await seedSeasons(t);
    const [champion, zed, bea, abe] = await Promise.all([
      seedUser(t, "Champion"),
      seedUser(t, "Zed"),
      seedUser(t, "Bea"),
      seedUser(t, "Abe"),
    ]);
    const [laterEpisodeId, earlierEpisodeId] = await Promise.all([
      seedEpisode(t, { number: 8, status: "published" }),
      seedEpisode(t, { number: 7, status: "published" }),
    ]);
    const later = { episodeId: laterEpisodeId, seasonId: pastSeasonId };
    const earlier = { episodeId: earlierEpisodeId, seasonId: pastSeasonId };
    await insertQuote(t, {
      ...later,
      userId: champion,
      quoteText: "Later winner",
      status: "INCLUDED",
      placement: 1,
    });
    await insertQuote(t, {
      ...later,
      userId: zed,
      quoteText: "Later second",
      status: "INCLUDED",
      placement: 2,
    });
    // Entries that did not place: bracket order first, then oldest first.
    await insertQuote(t, {
      ...later,
      userId: zed,
      quoteText: "Bracket slot two",
      status: "INCLUDED",
      bracketOrder: 2,
      createdAt: 1,
    });
    await insertQuote(t, {
      ...later,
      userId: bea,
      quoteText: "Bracket slot one",
      status: "INCLUDED",
      bracketOrder: 1,
      createdAt: 2,
    });
    await insertQuote(t, {
      ...later,
      userId: abe,
      quoteText: "Submitted later",
      createdAt: 9,
    });
    await insertQuote(t, {
      ...later,
      userId: champion,
      quoteText: "Submitted earlier",
      createdAt: 3,
    });
    await insertQuote(t, {
      ...earlier,
      userId: champion,
      quoteText: "Earlier winner",
      status: "INCLUDED",
      placement: 1,
    });
    await insertQuote(t, {
      ...earlier,
      userId: bea,
      quoteText: "Earlier second",
      status: "INCLUDED",
      placement: 2,
    });
    await insertQuote(t, {
      ...earlier,
      userId: abe,
      quoteText: "Earlier third",
      status: "INCLUDED",
      placement: 3,
    });
    await insertQuote(t, {
      ...earlier,
      userId: abe,
      quoteText: "Earlier also third",
      status: "INCLUDED",
      placement: 3,
    });

    const detail = await t.query(api.games.public.quotabungaSeason, {
      seasonId: pastSeasonId,
      today: TODAY,
      now: NOW,
    });

    expect(detail?.rounds.map((round) => round.episode.number)).toEqual([8, 7]);
    expect(
      detail?.rounds[0]?.entries.map((entry) => entry.quoteText),
    ).toEqual([
      "Later winner",
      "Later second",
      "Bracket slot one",
      "Bracket slot two",
      "Submitted earlier",
      "Submitted later",
    ]);
    // Most wins, then points, then entries, then name.
    expect(
      detail?.listeners.map((listener) => [
        listener.user.name,
        listener.wins,
        listener.points,
        listener.entryCount,
      ]),
    ).toEqual([
      ["Champion", 2, 80, 3],
      ["Abe", 0, 20, 3],
      ["Bea", 0, 20, 2],
      ["Zed", 0, 20, 2],
    ]);
  });

  test("lists only seasons with quotes when no season is current", async () => {
    const t = createTestBackend();
    const { currentSeasonId, pastSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Listener");
    const episodeId = await seedEpisode(t, { number: 5, status: "published" });
    await insertQuote(t, {
      userId,
      episodeId,
      seasonId: pastSeasonId,
      quoteText: "Past quote",
    });
    // Before the first season started, nothing is current.
    const today = "2025-01-01";

    expect(
      (await t.query(api.games.public.quotabungaSeasons, { today })).map(
        (season) => [season.title, season.isCurrent],
      ),
    ).toEqual([["Season 2", false]]);

    // The season that would be current gets no open round outside its dates.
    await seedEpisode(t, { number: 9, status: "next" });
    const detail = await t.query(api.games.public.quotabungaSeason, {
      seasonId: currentSeasonId,
      today,
      now: NOW,
    });
    expect(detail).toMatchObject({
      season: { isCurrent: false },
      rounds: [],
      listeners: [],
    });

    const empty = createTestBackend();
    expect(
      await empty.query(api.games.public.quotabungaSeasons, { today: TODAY }),
    ).toEqual([]);
  });

  test("rejects a date that is not a real calendar day", async () => {
    const t = createTestBackend();
    const { pastSeasonId } = await seedSeasons(t);

    for (const today of ["07/24/2026", "2026-02-30", ""]) {
      for (const read of [
        () => t.query(api.games.public.quotabungaSeasons, { today }),
        () =>
          t.query(api.games.public.quotabungaSeason, {
            seasonId: pastSeasonId,
            today,
            now: NOW,
          }),
      ]) {
        await expect(read()).rejects.toSatisfy(
          (error) =>
            error instanceof ConvexError &&
            (error.data as { code?: string }).code === "VALIDATION_FAILED",
        );
      }
    }
  });

  test("fails closed when there are too many seasons to list", async () => {
    const t = createTestBackend();
    await t.run(async (ctx) => {
      const gameTypeId = await ctx.db.insert("gameTypes", {
        title: "Quotabunga",
        lookupId: "quotabunga",
        normalizedLookupId: "quotabunga",
      });
      for (let index = 0; index <= MAX_SEASONS_TO_INSPECT; index += 1) {
        await ctx.db.insert("seasons", {
          title: `Season ${String(index)}`,
          gameTypeId,
          startedOn: `${String(1900 + index)}-01-01`,
          endedOn: `${String(1900 + index)}-12-31`,
        });
      }
    });

    await expectConflict(
      t.query(api.games.public.quotabungaSeasons, { today: TODAY }),
    );
  });

  test("returns null for a season that does not exist", async () => {
    const t = createTestBackend();
    const { quietSeasonId } = await seedSeasons(t);
    await t.run(async (ctx) => {
      await ctx.db.delete("seasons", quietSeasonId);
    });

    expect(
      await t.query(api.games.public.quotabungaSeason, {
        seasonId: quietSeasonId,
        today: TODAY,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("fails closed on broken relationships and oversized seasons", async () => {
    const t = createTestBackend();
    const { currentSeasonId, pastSeasonId, quietSeasonId } =
      await seedSeasons(t);
    const userId = await seedUser(t, "Listener");
    const goneUserId = await seedUser(t, "Gone");
    const episodeId = await seedEpisode(t, { number: 5, status: "published" });
    const goneEpisodeId = await seedEpisode(t, {
      number: 4,
      status: "published",
    });
    await insertQuote(t, {
      userId: goneUserId,
      episodeId,
      seasonId: pastSeasonId,
      quoteText: "Orphaned by its listener",
      status: "INCLUDED",
      placement: 1,
    });
    await insertQuote(t, {
      userId,
      episodeId: goneEpisodeId,
      seasonId: quietSeasonId,
      quoteText: "Orphaned by its episode",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("users", goneUserId);
      await ctx.db.delete("episodes", goneEpisodeId);
      for (
        let index = 0;
        index <= MAX_QUOTE_SUBMISSIONS_PER_SEASON;
        index += 1
      ) {
        await ctx.db.insert("quoteSubmissions", {
          userId,
          episodeId,
          seasonId: currentSeasonId,
          quoteText: "Synthetic quote",
          sourceTitle: "Synthetic source",
          sourceType: "MOVIE",
          status: "SUBMITTED",
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    for (const seasonId of [pastSeasonId, quietSeasonId, currentSeasonId]) {
      await expectConflict(
        t.query(api.games.public.quotabungaSeason, {
          seasonId,
          today: TODAY,
          now: NOW,
        }),
      );
    }
  });
});
