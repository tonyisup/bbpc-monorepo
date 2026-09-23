import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test } from "vitest";

import {
  SeasonProgress,
  formatSeasonProgress,
  getSeasonProgress,
} from "@/components/SeasonProgress";
import type { GamePerformanceData } from "@/types/game";

function performance(
  episodeCount: number | null,
  recordedEpisodeCount: number | null
): GamePerformanceData {
  return {
    season: { id: "season", title: "Season 5", endedOn: null, episodeCount },
    recordedEpisodeCount,
    userSummary: [],
    points: [],
  };
}

function renderText(recorded: number, total: number): string {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(<SeasonProgress progress={{ recorded, total }} />);
  });
  if (renderer === undefined) {
    throw new Error("SeasonProgress did not render.");
  }
  return renderer.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join("");
}

describe("season progress", () => {
  test("shows only for fixed-length seasons with a recorded count", () => {
    expect(getSeasonProgress(performance(20, 7))).toEqual({
      recorded: 7,
      total: 20,
    });
    expect(getSeasonProgress(performance(null, null))).toBeNull();
    expect(getSeasonProgress(performance(20, null))).toBeNull();
  });

  test("counts down to the finale and caps overruns", () => {
    expect(renderText(7, 20)).toContain("7 of 20 episodes · 13 episodes to go");
    expect(renderText(19, 20)).toContain("1 episode to go");
    expect(renderText(20, 20)).toContain("Final episode recorded");
    expect(formatSeasonProgress({ recorded: 22, total: 20 })).toBe(
      "20 of 20 episodes"
    );
  });
});
