import { describe, expect, test } from "vitest";

import {
  type BracketEvent,
  type BracketView,
  type MatchSide,
  bracketJudgeNames,
  bracketTargets,
  deriveBracket,
  seedSlots,
} from "./quotabungaBracketModel";

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `e${String(index + 1)}`);

const start = (count: number, target: number): BracketEvent => ({
  type: "start",
  target,
  entryIds: ids(count),
});

/** Votes for every entry in a round, where the first `keeps` judges keep it. */
function cutRound(keeps: Record<string, number>): BracketEvent[] {
  return [
    ...Object.entries(keeps).flatMap(([entryId, count]) =>
      [0, 1, 2].map(
        (judge): BracketEvent => ({
          type: "cutVote",
          entryId,
          judge,
          keep: judge < count,
        })
      )
    ),
    { type: "closeRound" },
  ];
}

/** The judges' votes on a matchup, in judge order. */
const matchup = (matchId: string, ...sides: MatchSide[]): BracketEvent[] =>
  sides.map((side, judge) => ({ type: "matchVote", matchId, judge, side }));

function derive(events: BracketEvent[]): BracketView {
  const view = deriveBracket(events);
  if (view === null) throw new Error("Expected a bracket");
  return view;
}

describe("bracket sizes", () => {
  test("offers every power of two from 4 up to the entry count", () => {
    expect(bracketTargets(3)).toEqual([]);
    expect(bracketTargets(4)).toEqual([4]);
    expect(bracketTargets(11)).toEqual([4, 8]);
    expect(bracketTargets(16)).toEqual([4, 8, 16]);
  });

  test("slots seeds so the top two can only meet in the final", () => {
    expect(seedSlots(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  test("refuses a start that isn't a bracket", () => {
    expect(deriveBracket([])).toBeNull();
    expect(deriveBracket([start(8, 6)])).toBeNull();
    expect(deriveBracket([start(3, 4)])).toBeNull();
    expect(deriveBracket([start(8, 16)])).toBeNull();
    expect(
      deriveBracket([{ type: "start", target: 4, entryIds: ["a", "a", "b", "c"] }])
    ).toBeNull();
  });
});

describe("cut rounds", () => {
  test("keeps the judges it started with", () => {
    expect(derive([start(4, 4)]).judges).toBeNull();
    expect(
      derive([{ ...start(4, 4), judges: ["Fonso", "Harley", "MCP"] } as BracketEvent])
        .judges
    ).toEqual(["Fonso", "Harley", "MCP"]);
  });

  test("skips the cuts when the round is already a bracket", () => {
    const view = derive([start(4, 4)]);
    expect(view.cut).toBeNull();
    expect(view.seeds).toEqual(ids(4));
    expect(view.rounds.map((round) => round.label)).toEqual([
      "Semifinals",
      "Final",
    ]);
    expect(view.current).toMatchObject({ label: "Semifinal 1", a: "e1", b: "e4" });
  });

  test("keeps entries two judges keep, and stops at the target", () => {
    const view = derive([
      start(6, 4),
      ...cutRound({ e1: 2, e2: 3, e3: 2, e4: 2, e5: 1, e6: 0 }),
    ]);
    expect(view.cut).toBeNull();
    expect([...(view.seeds ?? [])].sort()).toEqual(["e1", "e2", "e3", "e4"]);
    expect(view.history[0]?.outcomes).toMatchObject({ e5: "cut", e6: "cut" });
  });

  test("runs more rounds until the target is reached", () => {
    let view = derive([
      start(10, 4),
      ...cutRound({
        e1: 2, e2: 2, e3: 2, e4: 2, e5: 2, e6: 2, e7: 2, e8: 1, e9: 0, e10: 1,
      }),
    ]);
    expect(view.cut).toMatchObject({
      label: "Cut round 2",
      pool: ["e1", "e2", "e3", "e4", "e5", "e6", "e7"],
      need: 4,
      tiebreak: false,
    });
    view = derive([
      start(10, 4),
      ...cutRound({
        e1: 2, e2: 2, e3: 2, e4: 2, e5: 2, e6: 2, e7: 2, e8: 1, e9: 0, e10: 1,
      }),
      ...cutRound({ e1: 3, e2: 0, e3: 2, e4: 1, e5: 2, e6: 2, e7: 1 }),
    ]);
    expect([...(view.seeds ?? [])].sort()).toEqual(["e1", "e3", "e5", "e6"]);
  });

  test("brings back the cut entries with the most keeps when too few survive", () => {
    const view = derive([
      start(6, 4),
      ...cutRound({ e1: 2, e2: 2, e3: 3, e4: 1, e5: 0, e6: 0 }),
    ]);
    expect([...(view.seeds ?? [])].sort()).toEqual(["e1", "e2", "e3", "e4"]);
    expect(view.history[0]?.outcomes.e4).toBe("back");
  });

  test("sends entries tied for the last spots to a tiebreak among themselves", () => {
    const round1 = cutRound({
      e1: 3, e2: 2, e3: 2, e4: 2, e5: 2, e6: 2, e7: 1, e8: 1, e9: 1, e10: 0, e11: 0,
    });
    let view = derive([start(11, 8), ...round1]);
    expect(view.history[0]?.outcomes).toMatchObject({
      e1: "kept",
      e7: "tiebreak",
      e9: "tiebreak",
      e10: "cut",
    });
    expect(view.cut).toMatchObject({
      label: "Tiebreak 1",
      tiebreak: true,
      pool: ["e7", "e8", "e9"],
      need: 2,
    });

    view = derive([
      start(11, 8),
      ...round1,
      ...cutRound({ e7: 3, e8: 0, e9: 2 }),
    ]);
    expect(view.cut).toBeNull();
    expect([...(view.seeds ?? [])].sort()).toEqual(
      ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e9"].sort()
    );
  });

  test("a tiebreak that is itself tied goes to another tiebreak", () => {
    const view = derive([
      start(6, 4),
      ...cutRound({ e1: 2, e2: 2, e3: 1, e4: 1, e5: 1, e6: 0 }),
      ...cutRound({ e3: 3, e4: 1, e5: 1 }),
    ]);
    expect(view.cut).toMatchObject({
      label: "Tiebreak 2",
      pool: ["e4", "e5"],
      need: 1,
    });
    expect(view.history.map((round) => round.label)).toEqual([
      "Cut round 1",
      "Tiebreak 1",
    ]);
    const done = derive([
      start(6, 4),
      ...cutRound({ e1: 2, e2: 2, e3: 1, e4: 1, e5: 1, e6: 0 }),
      ...cutRound({ e3: 3, e4: 1, e5: 1 }),
      ...cutRound({ e4: 0, e5: 2 }),
    ]);
    expect([...(done.seeds ?? [])].sort()).toEqual(["e1", "e2", "e3", "e5"]);
  });

  test("a round that would cut nobody cuts the entries with the fewest keeps", () => {
    const view = derive([
      start(5, 4),
      ...cutRound({ e1: 3, e2: 3, e3: 3, e4: 3, e5: 2 }),
    ]);
    expect([...(view.seeds ?? [])].sort()).toEqual(["e1", "e2", "e3", "e4"]);
    expect(view.history[0]?.outcomes.e5).toBe("cut");
  });

  test("votes the round again when every entry got the same keeps", () => {
    const view = derive([
      start(5, 4),
      ...cutRound({ e1: 2, e2: 2, e3: 2, e4: 2, e5: 2 }),
    ]);
    expect(view.history[0]?.stalemate).toBe(true);
    expect(view.cut).toMatchObject({
      label: "Cut round 2",
      pool: ids(5),
      need: 4,
      complete: false,
    });
  });

  test("the admin can pick who goes through by hand", () => {
    const events: BracketEvent[] = [
      start(6, 4),
      ...cutRound({ e1: 2, e2: 2, e3: 1, e4: 1, e5: 1, e6: 0 }),
    ];
    // The tiebreak needs two, so picking one is ignored.
    expect(
      derive([...events, { type: "pick", entryIds: ["e3"] }]).cut?.need
    ).toBe(2);
    const view = derive([...events, { type: "pick", entryIds: ["e5", "e3"] }]);
    expect(view.cut).toBeNull();
    expect([...(view.seeds ?? [])].sort()).toEqual(["e1", "e2", "e3", "e5"]);
    expect(view.history.at(-1)).toMatchObject({ picked: true });
  });

  test("ignores a pick naming an outsider or an entry twice", () => {
    expect(
      derive([start(6, 4), { type: "pick", entryIds: ["e1", "e2", "e3", "x"] }])
        .cut?.label
    ).toBe("Cut round 1");
    expect(
      derive([start(6, 4), { type: "pick", entryIds: ["e1", "e1", "e2", "e3"] }])
        .cut?.label
    ).toBe("Cut round 1");
    const view = derive([
      start(6, 4),
      { type: "pick", entryIds: ["e6", "e2", "e4", "e1"] },
    ]);
    expect(view.cut).toBeNull();
    expect(view.seeds).toEqual(["e1", "e2", "e4", "e6"]);
  });

  test("seeds by keeps summed over the cut rounds, not the tiebreaks", () => {
    const view = derive([
      start(10, 4),
      ...cutRound({
        e1: 2, e2: 2, e3: 2, e4: 2, e5: 2, e6: 2, e7: 2, e8: 1, e9: 0, e10: 1,
      }),
      ...cutRound({ e1: 3, e2: 0, e3: 2, e4: 1, e5: 2, e6: 2, e7: 1 }),
    ]);
    expect(view.seeds).toEqual(["e1", "e3", "e5", "e6"]);

    // e3 and e5 win the tiebreak with 3 keeps, but seed below e1 and e2,
    // which kept more in the cut round.
    const tiebroken = derive([
      start(6, 4),
      ...cutRound({ e1: 3, e2: 2, e3: 1, e4: 1, e5: 1, e6: 0 }),
      ...cutRound({ e3: 3, e4: 0, e5: 3 }),
    ]);
    expect(tiebroken.seeds).toEqual(["e1", "e2", "e3", "e5"]);
  });

  test("closes a round only once every vote is in, and the latest vote counts", () => {
    const partial = derive([
      start(5, 4),
      { type: "cutVote", entryId: "e1", judge: 0, keep: true },
      { type: "cutVote", entryId: "e1", judge: 0, keep: false },
      { type: "cutVote", entryId: "nope", judge: 0, keep: true },
      { type: "cutVote", entryId: "e2", judge: 3, keep: true },
      { type: "closeRound" },
    ]);
    expect(partial.history).toEqual([]);
    expect(partial.cut?.votes.e1).toEqual([false, null, null]);
    expect(partial.cut?.votes.e2).toEqual([null, null, null]);
    expect(partial.cut?.complete).toBe(false);
  });

  test("seeds by keeps in the cut rounds, then recording order", () => {
    const view = derive([
      start(6, 4),
      ...cutRound({ e1: 2, e2: 2, e3: 3, e4: 3, e5: 1, e6: 0 }),
    ]);
    expect(view.seeds).toEqual(["e3", "e4", "e1", "e2"]);
    expect(view.current).toMatchObject({ a: "e3", b: "e2" });
  });
});

describe("matchups", () => {
  test("plays the bracket, then the 3rd-place match, then the final", () => {
    const events: BracketEvent[] = [
      start(4, 4),
      ...matchup("r1m1", "a", "a", "b"), // e1 beats e4
      ...matchup("r1m2", "b", "b", "b"), // e3 beats e2
    ];
    let view = derive(events);
    expect(view.rounds[0]?.matches.map((match) => match.winner)).toEqual([
      "e1",
      "e3",
    ]);
    expect(view.current).toMatchObject({
      id: "third",
      label: "3rd-place match",
      a: "e4",
      b: "e2",
    });
    view = derive([...events, ...matchup("third", "b", "a", "b")]);
    expect(view.thirdPlace?.winner).toBe("e2");
    expect(view.current).toMatchObject({ label: "Final", a: "e1", b: "e3" });
    expect(view.placements).toBeNull();

    view = derive([
      ...events,
      ...matchup("third", "b", "a", "b"),
      ...matchup("r2m1", "b", "b", "a"),
    ]);
    expect(view.current).toBeNull();
    expect(view.placements).toEqual(["e3", "e1", "e2"]);
  });

  test("decides a matchup once all three judges vote, and undo reopens it", () => {
    const events: BracketEvent[] = [start(4, 4), ...matchup("r1m1", "a", "b")];
    expect(derive(events).current).toMatchObject({
      label: "Semifinal 1",
      votes: ["a", "b", null],
    });
    const decided = derive([...events, ...matchup("r1m1", "b", "b", "a").slice(2)]);
    expect(decided.rounds[0]?.matches[0]?.winner).toBe("e1");
    expect(decided.current?.label).toBe("Semifinal 2");
    // Undo drops the last event.
    expect(derive(events).current?.label).toBe("Semifinal 1");
  });

  test("a vote for a matchup that already ended doesn't reach the next one", () => {
    const deciding: BracketEvent[] = [start(4, 4), ...matchup("r1m1", "a", "a", "b")];
    // A double-click repeats the deciding vote after Semifinal 1 has ended.
    const view = derive([...deciding, ...matchup("r1m1", "a", "a", "b").slice(2)]);
    expect(view.current).toMatchObject({
      label: "Semifinal 2",
      votes: [null, null, null],
    });
  });

  test("an 8-entry bracket plays quarterfinals in slot order", () => {
    const view = derive([start(8, 8)]);
    expect(view.rounds.map((round) => round.label)).toEqual([
      "Quarterfinals",
      "Semifinals",
      "Final",
    ]);
    expect(
      view.rounds[0]?.matches.map((match) => [match.label, match.a, match.b])
    ).toEqual([
      ["Quarterfinal 1", "e1", "e8"],
      ["Quarterfinal 2", "e4", "e5"],
      ["Quarterfinal 3", "e2", "e7"],
      ["Quarterfinal 4", "e3", "e6"],
    ]);
  });

  test("ignores matchup votes from unknown judges and after the final", () => {
    const done: BracketEvent[] = [
      start(4, 4),
      ...matchup("r1m1", "a", "a", "a"),
      ...matchup("r1m2", "a", "a", "a"),
      ...matchup("third", "a", "a", "a"),
      ...matchup("r2m1", "a", "a", "a"),
    ];
    const { placements } = derive(done);
    expect(placements).toEqual(["e1", "e2", "e4"]);
    expect(
      derive([
        ...done,
        { type: "matchVote", matchId: "r2m1", judge: 3, side: "b" },
        ...matchup("r2m1", "b", "b", "b"),
      ]).placements
    ).toEqual(placements);
    expect(
      derive([start(4, 4), { type: "matchVote", matchId: "r1m1", judge: -1, side: "a" }])
        .current?.votes
    ).toEqual([null, null, null]);
  });

  test("ignores matchup votes before the bracket is set", () => {
    const view = derive([start(5, 4), ...matchup("r1m1", "a", "a", "a")]);
    expect(view.seeds).toBeNull();
    expect(view.cut?.pool).toEqual(ids(5));
  });
});

describe("judges", () => {
  const role = (name: string) => ({
    id: name,
    assignedAt: null,
    assignedBy: null,
    role: {
      id: name,
      legacyId: null,
      name,
      description: "",
      admin: true,
      permissions: [],
    },
  });
  const user = (
    name: string,
    roles: string[],
    status: "active" | "disabled" = "active"
  ) => ({ name, email: null, status, roles: roles.map(role) });

  test("never show a host's whole email, or a blank name", () => {
    expect(
      bracketJudgeNames([
        { ...user("", ["Host"]), email: "fonso@example.com" },
        user("Harley", ["Host"]),
        user("MCP", ["Host"]),
      ])
    ).toEqual(["fonso", "Harley", "MCP"]);
  });

  test("are the three active hosts by name", () => {
    expect(
      bracketJudgeNames([
        user("MCP", ["Host", "Admin"]),
        user("Harley", ["Host"]),
        user("Fonso", ["host"]),
        user("Producer", ["Admin"]),
        user("Former", ["Host"], "disabled"),
      ])
    ).toEqual(["Fonso", "Harley", "MCP"]);
  });

  test("fall back to numbered judges without exactly three hosts", () => {
    expect(
      bracketJudgeNames([user("Harley", ["Host"]), user("Fonso", ["Host"])])
    ).toEqual(["Judge 1", "Judge 2", "Judge 3"]);
  });
});
