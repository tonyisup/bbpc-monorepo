import { describe, expect, test } from "vitest";

import { stableShuffle } from "./stableShuffle";

const ids = Array.from({ length: 12 }, (_, index) => `entry-${String(index)}`);
const shuffle = (items: string[], seed = "episode-1") =>
  stableShuffle(items, (item) => item, seed);

describe("stable shuffle", () => {
  test("gives the same order for the same seed, whatever the input order", () => {
    expect(shuffle(ids)).toEqual(shuffle([...ids].reverse()));
    expect([...shuffle(ids)].sort()).toEqual([...ids].sort());
  });

  test("doesn't keep the input order, and a new seed gives a new order", () => {
    expect(shuffle(ids)).not.toEqual(ids);
    expect(shuffle(ids, "episode-2")).not.toEqual(shuffle(ids));
  });

  test("adding an entry leaves the others in the same relative order", () => {
    const before = shuffle(ids.slice(0, 11));
    const after = shuffle(ids).filter((id) => id !== "entry-11");
    expect(after).toEqual(before);
  });
});
