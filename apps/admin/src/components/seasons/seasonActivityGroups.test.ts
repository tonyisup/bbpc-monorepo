import { describe, expect, it } from "vitest";

import { groupSeasonActivityByEpisode } from "./seasonActivityGroups";

const episode = (number: number) => ({
  id: `episode-${number}`,
  number,
  title: `Episode ${number}`,
});

describe("groupSeasonActivityByEpisode", () => {
  it("groups newest episode first and puts unlinked activity last", () => {
    const items = [
      { id: "a", episode: null },
      { id: "b", episode: episode(12) },
      { id: "c", episode: episode(11) },
      { id: "d", episode: episode(12) },
      { id: "e", episode: null },
    ];

    expect(
      groupSeasonActivityByEpisode(items, (item) => item.episode).map(
        (group) => [group.episode?.number ?? null, group.items.map(({ id }) => id)]
      )
    ).toEqual([
      [12, ["b", "d"]],
      [11, ["c"]],
      [null, ["a", "e"]],
    ]);
  });

  it("returns no groups for no activity", () => {
    expect(groupSeasonActivityByEpisode([], () => null)).toEqual([]);
  });
});
