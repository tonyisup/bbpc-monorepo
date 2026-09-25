import { describe, expect, test } from "vitest";

import type { ConvexSeasonPoint, ConvexSeasonWager } from "@/convex/seasons";
import {
  buildSeasonSeries,
  formatWagerRecord,
  groupSeasonPointsByEpisode,
  ordinal,
  summarizeSeasonWagers,
} from "@/lib/seasonActivity";

const episode418 = {
  id: "ep-418",
  number: 418,
  title: "Episode 418",
  slug: "episode-418",
};
const episode417 = {
  id: "ep-417",
  number: 417,
  title: "Episode 417",
  slug: null,
};
const heat = {
  id: "a-heat",
  type: "HOMEWORK" as const,
  slug: "heat",
  movie: { id: "m-heat", title: "Heat", year: 1995, poster: null },
};

function point(
  overrides: Partial<ConvexSeasonPoint> & { id: string }
): ConvexSeasonPoint {
  return {
    reason: null,
    earnedAt: 1,
    adjustment: null,
    total: 1,
    gamePointType: null,
    episode: null,
    assignment: null,
    ...overrides,
  };
}

function wager(
  overrides: Partial<ConvexSeasonWager> & { id: string }
): ConvexSeasonWager {
  return {
    points: 5,
    createdAt: 1,
    status: "pending",
    gamblingType: { title: "Double Down", multiplier: 2 },
    assignment: null,
    awardPoint: null,
    ...overrides,
  };
}

// Sept 15 and Sept 22, 2026 at 13:00 Pacific.
const DAY_ONE = Date.UTC(2026, 8, 15, 20);
const DAY_TWO = Date.UTC(2026, 8, 22, 20);

describe("season points by episode", () => {
  test("groups newest episode first, assignments before loose points, adjustments last", () => {
    const groups = groupSeasonPointsByEpisode([
      point({ id: "quote-418", total: 20, episode: episode418 }),
      point({ id: "wager-418", total: 10, episode: episode418, assignment: heat }),
      point({ id: "guess-418", total: 1, episode: episode418, assignment: heat }),
      point({ id: "quote-417", total: 5, episode: episode417 }),
      point({ id: "manual", total: -1 }),
    ]);
    expect(
      groups.map((group) => [group.key, group.subtotal])
    ).toEqual([
      ["ep-418", 31],
      ["ep-417", 5],
      ["none", -1],
    ]);
    expect(
      groups[0]?.blocks.map((block) => [
        block.assignment?.movie.title ?? null,
        block.points.map((entry) => entry.id),
      ])
    ).toEqual([
      ["Heat", ["wager-418", "guess-418"]],
      [null, ["quote-418"]],
    ]);
    expect(groups[2]?.episode).toBeNull();
  });
});

describe("season series", () => {
  const overview = {
    userSummary: [
      { id: "rival", name: "Dana", total: 25 },
      { id: "me", name: "Me", total: 14 },
    ],
    points: [
      { userId: "me", earnedAt: DAY_ONE, pointValue: 10 },
      { userId: "rival", earnedAt: DAY_ONE + 3_600_000, pointValue: 25 },
      { userId: "me", earnedAt: DAY_TWO, pointValue: 4 },
    ],
  };

  test("accumulates you, the leader, and the field average per scoring day", () => {
    const series = buildSeasonSeries(overview, "me");
    expect(series.comparison).toEqual({
      id: "rival",
      name: "Dana",
      label: "Leader",
    });
    expect(series.rows).toEqual([
      { date: "Sep 15", you: 10, comparison: 25, average: 17.5 },
      { date: "Sep 22", you: 14, comparison: 25, average: 19.5 },
    ]);
  });

  test("compares the leader against the runner-up", () => {
    const series = buildSeasonSeries(overview, "rival");
    expect(series.comparison?.label).toBe("Runner-up");
    expect(series.rows.at(-1)).toMatchObject({ you: 25, comparison: 14 });
    expect(buildSeasonSeries({ userSummary: [], points: [] }, "me")).toEqual({
      rows: [],
      comparison: null,
    });
  });
});

describe("season wagers", () => {
  test("summarizes the record, open stakes, and net from settled wagers", () => {
    const summary = summarizeSeasonWagers([
      wager({
        id: "w1",
        status: "won",
        points: 5,
        awardPoint: { total: 10 },
        assignment: {
          id: "a-heat",
          slug: "heat",
          movie: { title: "Heat", year: 1995, poster: null },
          episode: episode418,
        },
      }),
      wager({ id: "w2", status: "lost", points: 4, awardPoint: { total: -4 } }),
      wager({ id: "w3", status: "pending", points: 8 }),
      wager({ id: "w4", status: "locked", points: 8 }),
      wager({ id: "w5", status: "lost", points: 3 }),
      wager({ id: "w6", status: "rejected", points: 9 }),
    ]);
    expect(summary).toEqual({
      won: 1,
      lost: 2,
      open: 2,
      staked: 16,
      net: 3,
    });
    expect(formatWagerRecord(summary)).toBe("1–2");
  });
});

describe("ordinals", () => {
  test("handles the teens and every last digit", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "111th",
    ]);
  });
});
