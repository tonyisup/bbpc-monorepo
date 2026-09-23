import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, test } from "vitest";

import { SeasonPositionBadges } from "./SeasonPositionBadges";

function text(
  position: number | null,
  season: { title: string; episodeCount: number | null } | null
): string {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      <SeasonPositionBadges position={position} season={season} />
    );
  });
  return JSON.stringify(renderer?.toJSON() ?? null)
    .replace(/","/gu, "")
    .replace(/\\"/gu, '"');
}

describe("SeasonPositionBadges", () => {
  test("shows the position with and without a season length", () => {
    expect(text(7, { title: "Season 5", episodeCount: 20 })).toContain(
      "#7 of 20 in Season 5"
    );
    expect(text(7, { title: "Season 5", episodeCount: null })).toContain(
      "#7 in Season 5"
    );
  });

  test("flags the finale and an overrun", () => {
    const finale = text(20, { title: "Season 5", episodeCount: 20 });
    expect(finale).toContain("Season finale");
    expect(finale).not.toContain("Past season length");
    expect(text(21, { title: "Season 5", episodeCount: 20 })).toContain(
      "Past season length"
    );
    expect(text(19, { title: "Season 5", episodeCount: 20 })).not.toMatch(
      /Season finale|Past season length/u
    );
  });

  test("renders nothing without a position or season", () => {
    expect(text(null, { title: "Season 5", episodeCount: 20 })).toBe("null");
    expect(text(7, null)).toBe("null");
  });
});
