import { describe, expect, test } from "vitest";

import {
  buildChartData,
  buildSummaryRows,
} from "@/components/GamePerformanceTracking";

const userSummary = [
  { id: "u1", name: "Ada", total: 6 },
  { id: "u2", name: null, total: 3 },
];

describe("performance tracking summary", () => {
  test("shows each player's points from the latest Pacific scoring day", () => {
    const points = [
      { userId: "u1", earnedAt: Date.parse("2026-09-04T03:00:00Z"), pointValue: 5 },
      { userId: "u2", earnedAt: Date.parse("2026-09-04T03:30:00Z"), pointValue: 3 },
      { userId: "u1", earnedAt: Date.parse("2026-09-11T02:00:00Z"), pointValue: 2 },
      // Still Sep 10 in Pacific time, though Sep 11 in UTC.
      { userId: "u1", earnedAt: Date.parse("2026-09-11T06:30:00Z"), pointValue: -1 },
    ];
    const chartData = buildChartData(points, userSummary);

    expect(buildSummaryRows(chartData, points, userSummary)).toEqual({
      lastEpisodeLabel: "Sep 10",
      rows: [
        { id: "u1", name: "Ada", latestScore: 6, peakScore: 6, lastEpisodeScore: 1 },
        { id: "u2", name: "Player", latestScore: 3, peakScore: 3, lastEpisodeScore: 0 },
      ],
    });
  });

  test("has no last episode before any scoring", () => {
    expect(buildSummaryRows([], [], userSummary)).toMatchObject({
      lastEpisodeLabel: null,
      rows: [{ lastEpisodeScore: 0 }, { lastEpisodeScore: 0 }],
    });
  });
});
