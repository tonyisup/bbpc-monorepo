import { describe, expect, it } from "vitest";

import { parseSeasonEpisodeCount } from "./seasonEditorModel";

describe("parseSeasonEpisodeCount", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["1", 1],
    [" 20 ", 20],
    ["500", 500],
    ["0", undefined],
    ["501", undefined],
    ["2.5", undefined],
    ["-3", undefined],
    ["abc", undefined],
  ])("reads %j as %j", (input, expected) => {
    expect(parseSeasonEpisodeCount(input)).toBe(expected);
  });
});
