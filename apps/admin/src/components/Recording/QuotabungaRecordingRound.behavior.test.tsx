import type * as YouTubeModule from "@bbpc/youtube";
import type * as ReuseModule from "../Quotabunga/QuoteReuseChance";
import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

vi.mock("convex/react", () => ({ useConvex: () => ({}) }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
const reuse = vi.hoisted(() => ({ blind: [] as boolean[] }));
vi.mock("../Quotabunga/QuoteReuseChance", async (importOriginal) => ({
  ...(await importOriginal<typeof ReuseModule>()),
  QuoteReuseChance: ({ blind }: { blind?: boolean }) => {
    reuse.blind.push(blind === true);
    return null;
  },
}));
// An opened clip's player stays loading; these tests only check which opens.
vi.mock("@bbpc/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof YouTubeModule>()),
  loadYouTubeAPI: () => new Promise(() => undefined),
}));

import { QuoteClipPlayer } from "../Quotabunga/QuoteClipPlayer";
import { ConfirmModal } from "../ui/confirm-modal";
import { recordingOrder } from "../Quotabunga/recordingOrder";
import { QuotabungaRecordingRound } from "./ConvexRecordingManagementPage";

let view: ReactTestRenderer;

function submission(
  id: string,
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id,
    quoteText: `Quote ${id}`,
    sourceTitle: `Source ${id}`,
    sourceType: "MOVIE",
    clipUrl: null,
    clipStartSeconds: null,
    clipEndSeconds: null,
    listenerNotes: null,
    status: "INCLUDED",
    bracketOrder: null,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
    userId: `user-${id}`,
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: null,
    user: {
      id: `user-${id}`,
      name: `Listener ${id}`,
      email: null,
      image: null,
    },
    episode: {
      id: "episode-1",
      number: 1,
      title: "Pilot",
      status: "recording",
    },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const text = () => textOf(view.root);
const quotesInOrder = () =>
  view.root
    .findAllByType("blockquote")
    .map((node) => textOf(node).replace(/[“”]/g, ""));

async function render(submissions: ConvexAdminQuoteSubmission[]) {
  await act(async () => {
    view = create(
      <QuotabungaRecordingRound
        episodeId="episode-1"
        judges={["Fonso", "Harley", "MCP"]}
        onRefresh={vi.fn()}
        submissions={submissions}
      />
    );
  });
}

const JUDGES = ["Fonso", "Harley", "MCP"];
const BRACKET_KEY = "bbpc-admin:quotabunga-bracket:episode-1";

/** A browser whose storage starts with these values. */
function stubStorage(values: Record<string, string> = {}) {
  const stored = new Map(Object.entries(values));
  const listeners: ((event: { key: string }) => void)[] = [];
  vi.stubGlobal("window", {
    location: { origin: "http://localhost:3001" },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
    addEventListener: (_type: string, listener: (event: { key: string }) => void) =>
      listeners.push(listener),
    removeEventListener: (
      _type: string,
      listener: (event: { key: string }) => void
    ) => listeners.splice(listeners.indexOf(listener), 1),
  });
  /** Another tab of this browser saves a value. */
  const otherTab = (key: string, value: string) => {
    stored.set(key, value);
    act(() => listeners.forEach((listener) => listener({ key })));
  };
  return Object.assign(stored, { otherTab });
}

const storedEvents = (events: unknown[]) =>
  JSON.stringify({ version: 2, events });

function button(label: string): ReactTestInstance {
  const found = view.root
    .findAllByType("button")
    .find(
      (node) =>
        node.props["aria-label"] === label || textOf(node).trim() === label
    );
  if (found === undefined) throw new Error(`No button ${label}`);
  return found;
}

const click = (label: string) => act(() => button(label).props.onClick());

/** How the bracket names an entry of five(): its number and source. */
const entry = (id: string) =>
  `#${String("abcde".indexOf(id) + 1)} Source ${id}`;

/** Every judge keeps or cuts an entry. */
function judgeCut(id: string, keep: boolean) {
  for (const judge of JUDGES) {
    click(`${judge}: ${keep ? "keep" : "cut"} ${entry(id)}`);
  }
}

/** Each judge votes for an entry in the current matchup. */
function judgeMatchup(...ids: string[]) {
  ids.forEach((id, index) =>
    click(`${JUDGES[index] ?? ""}: vote for ${entry(id)}`)
  );
}

const five = () =>
  ["a", "b", "c", "d", "e"].map((id, index) =>
    submission(id, { bracketOrder: index + 1 })
  );

/** Seeds a–d in order with no cuts, then plays: a over d, c over b, b 3rd, c 1st. */
const finishedFour = [
  { type: "start", target: 4, entryIds: ["a", "b", "c", "d"] },
  ...["a", "a", "a"].map((side, judge) => ({ type: "matchVote", matchId: "r1m1", judge, side })),
  ...["b", "b", "b"].map((side, judge) => ({ type: "matchVote", matchId: "r1m2", judge, side })),
  ...["b", "b", "b"].map((side, judge) => ({ type: "matchVote", matchId: "third", judge, side })),
  ...["b", "b", "b"].map((side, judge) => ({ type: "matchVote", matchId: "r2m1", judge, side })),
];

const placementsShown = () =>
  Object.fromEntries(
    view.root
      .findAllByType("select")
      .map((node) => [node.props["aria-label"], node.props.value])
  );

async function rerender(submissions: ConvexAdminQuoteSubmission[], episodeId = "episode-1") {
  await act(async () => {
    view.update(
      <QuotabungaRecordingRound
        episodeId={episodeId}
        judges={JUDGES}
        onRefresh={vi.fn()}
        submissions={submissions}
      />
    );
  });
}

afterEach(() => {
  act(() => view?.unmount());
  vi.unstubAllGlobals();
});

describe("Quotabunga recording round", () => {
  test("hides names until points are awarded, unless shown on purpose", async () => {
    await render([
      submission("a", { bracketOrder: 1 }),
      submission("b", { bracketOrder: 2 }),
    ]);
    expect(text()).not.toContain("Listener a");
    expect(text()).toContain("Name hidden");
    // The reuse link opens its breakdown blind too.
    expect(reuse.blind.at(-1)).toBe(true);
    const select = view.root.findAllByType("select")[0];
    expect(select?.props["aria-label"]).toBe(
      "Placement for the Source a entry"
    );

    const toggle = view.root
      .findAllByType("button")
      .find((node) => textOf(node).includes("Show names"));
    act(() => toggle?.props.onClick());
    expect(text()).toContain("Listener a");
    expect(text()).toContain("Hide names");
    expect(reuse.blind.at(-1)).toBe(false);
  });

  test("names shown for one round are hidden again for the next", async () => {
    const entries = [submission("a", { bracketOrder: 1 })];
    await render(entries);
    act(() =>
      view.root
        .findAllByType("button")
        .find((node) => textOf(node).includes("Show names"))
        ?.props.onClick()
    );
    expect(text()).toContain("Listener a");
    await act(async () => {
      view.update(
        <QuotabungaRecordingRound
          episodeId="episode-2"
          onRefresh={vi.fn()}
          submissions={entries}
        />
      );
    });
    expect(text()).not.toContain("Listener a");
    expect(text()).toContain("Name hidden");
    // Coming back to the first round starts hidden again too.
    await act(async () => {
      view.update(
        <QuotabungaRecordingRound
          episodeId="episode-1"
          onRefresh={vi.fn()}
          submissions={entries}
        />
      );
    });
    expect(text()).not.toContain("Listener a");
  });

  test("shows names once any entry is scored, with no toggle", async () => {
    await render([
      submission("a", {
        bracketOrder: 1,
        placement: 1,
        scored: true,
        point: { id: "point-1", adjustment: 40, reason: null },
      }),
      submission("b", { bracketOrder: 2 }),
    ]);
    expect(text()).toContain("Listener a");
    expect(text()).toContain("Listener b");
    expect(text()).not.toContain("Show names");
  });

  test("shows listener and admin notes", async () => {
    await render([
      submission("a", {
        listenerNotes: "Said in the diner scene",
        adminNotes: "Audio is quiet; turn it up",
      }),
    ]);
    expect(text()).toContain("Listener: Said in the diner scene");
    expect(text()).toContain("Admin: Audio is quiet; turn it up");
  });

  test("plays randomized entries in bracket order, then the rest shuffled, never in submission order", async () => {
    const unbracketed = ["c", "d", "e", "f", "g", "h"].map((id) =>
      submission(id)
    );
    const entries = [
      ...unbracketed,
      submission("b", { bracketOrder: 2 }),
      submission("a", { bracketOrder: 1 }),
      submission("x", { status: "REJECTED" }),
    ];
    await render(entries);
    const order = quotesInOrder();
    expect(order.slice(0, 2)).toEqual(["Quote a", "Quote b"]);
    expect(order).toEqual(
      recordingOrder(entries, "episode-1").map((entry) => entry.quoteText)
    );
    expect(order.slice(2)).not.toEqual(
      unbracketed.map((entry) => entry.quoteText)
    );
    expect(order).not.toContain("Quote x");
  });

  test("plays one entry's clip at a time, in place", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3001" },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    await render([
      submission("a", {
        bracketOrder: 1,
        clipUrl: "https://youtu.be/abcdefghijk?t=40",
        clipStartSeconds: 40,
        clipEndSeconds: 44,
      }),
      submission("b", {
        bracketOrder: 2,
        clipUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        clipStartSeconds: 10,
      }),
      submission("c", { bracketOrder: 3, clipUrl: "https://vimeo.com/1" }),
    ]);
    const clipButtons = () =>
      view.root
        .findAllByType("button")
        .filter((node) => /^Play clip (from|\d)/.test(textOf(node).trim()));
    const players = () =>
      view.root
        .findAllByType(QuoteClipPlayer)
        .map((node) => node.props.videoId as string);
    expect(clipButtons().map((node) => textOf(node).trim())).toEqual([
      "Play clip 0:40.0–0:44.0",
      "Play clip from 0:10.0",
    ]);
    // The Vimeo entry keeps its link but gets no player. YouTube entries'
    // links don't repeat the range their Play clip button already shows.
    const links = view.root
      .findAllByType("a")
      .map((node) => textOf(node).trim());
    expect(links).toContain("Open clip");
    expect(links.filter((label) => label === "Open on YouTube")).toHaveLength(
      2
    );

    act(() => clipButtons()[0]?.props.onClick());
    expect(players()).toEqual(["abcdefghijk"]);
    act(() => clipButtons()[0]?.props.onClick());
    expect(players()).toEqual(["bbbbbbbbbbb"]);
    expect(clipButtons().map((node) => textOf(node).trim())).toEqual([
      "Play clip 0:40.0–0:44.0",
    ]);

    const close = view.root
      .findAllByType("button")
      .find((node) => textOf(node).trim() === "Close");
    act(() => close?.props.onClick());
    expect(players()).toEqual([]);
  });
});

describe("Quotabunga recording bracket", () => {
  test("cuts to the bracket, plays it, and fills in the placements", async () => {
    const stored = stubStorage();
    await render(five());
    expect(text()).toContain("Cut 5 → 4, then 2 bracket rounds");
    click("Start bracket");
    expect(stored.has(BRACKET_KEY)).toBe(true);

    expect(text()).toContain("Cut round 1: 4 of 5 go through");
    // Voting hides the placements, and names stay hidden.
    expect(view.root.findAllByType("select")).toHaveLength(0);
    expect(text()).not.toContain("Listener a");
    expect(button("Finish round").props.disabled).toBe(true);
    ["a", "b", "c", "d"].forEach((id) => judgeCut(id, true));
    judgeCut("e", false);
    expect(text()).toContain("15 of 15 votes in");
    click("Finish round");

    // Seeds 1 and 4 meet first; the judges' votes decide it.
    expect(text()).toContain("Semifinal 1: each judge votes for one entry");
    expect(quotesInOrder()).toEqual(["Quote a", "Quote d"]);
    judgeMatchup("a", "d", "a");
    // The result holds until the admin moves on.
    expect(text()).toContain("Semifinal 1: #1 Source a wins 2–1");
    expect(button(`Fonso: vote for ${entry("a")}`).props.disabled).toBe(true);
    click("Next matchup");
    expect(quotesInOrder()).toEqual(["Quote b", "Quote c"]);
    judgeMatchup("c", "c", "c");
    click("Next matchup");
    expect(text()).toContain("3rd-place match: each judge votes");
    judgeMatchup("d", "b", "b");
    click("Next matchup");
    expect(text()).toContain("Final: each judge votes");
    judgeMatchup("c", "a", "c");

    expect(text()).toContain(
      "1st: #3 Source c2nd: #1 Source a3rd: #2 Source b"
    );
    expect(placementsShown()).toEqual({
      "Placement for the Source a entry": 2,
      "Placement for the Source b entry": 3,
      "Placement for the Source c entry": 1,
      "Placement for the Source d entry": "",
      "Placement for the Source e entry": "",
    });
  });

  test("locks Award points while the bracket runs", async () => {
    stubStorage();
    await render(five());
    expect(button("Award points").props.disabled).toBe(false);
    click("Start bracket");
    expect(button("Award points").props.disabled).toBe(true);
  });

  test("says which judges still need to vote on an entry", async () => {
    stubStorage();
    await render(five());
    click("Start bracket");
    click(`Fonso: keep ${entry("a")}`);
    expect(text()).toContain("Waiting on Harley, MCP");
  });

  test("a repeated vote changes nothing, so undo takes back the real one", async () => {
    stubStorage();
    await render(five());
    click("Start bracket");
    click(`Fonso: keep ${entry("a")}`);
    click(`Fonso: keep ${entry("a")}`);
    click("Undo");
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(
      false
    );
  });

  test("undo takes back the last vote", async () => {
    stubStorage();
    await render(five());
    click("Start bracket");
    click(`Fonso: keep ${entry("a")}`);
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(true);
    click("Undo");
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(
      false
    );
    // Undoing the start goes back to setup.
    click("Undo");
    expect(text()).toContain("Start bracket");
  });

  test("the admin can put entries through by hand", async () => {
    stubStorage();
    await render(five());
    click("Start bracket");
    click("Pick by hand");
    expect(button("Put 0 of 4 through").props.disabled).toBe(true);
    ["a", "b", "c", "e"].forEach((id) => click(`Put ${entry(id)} through`));
    click("Put 4 of 4 through");
    expect(text()).toContain("Semifinal 1: each judge votes");
    expect(quotesInOrder()).toEqual(["Quote a", "Quote e"]);
  });

  test("picks up a stored bracket after a reload", async () => {
    stubStorage({
      [BRACKET_KEY]: storedEvents([
        { type: "start", target: 4, entryIds: ["a", "b", "c", "d", "e"] },
        { type: "cutVote", entryId: "b", judge: 1, keep: false },
      ]),
    });
    await render(five());
    expect(text()).toContain("Cut round 1: 4 of 5 go through");
    expect(button(`Harley: cut ${entry("b")}`).props["aria-pressed"]).toBe(
      true
    );
  });

  test("follows votes saved by another tab", async () => {
    const stored = stubStorage();
    await render(five());
    click("Start bracket");
    stored.otherTab(
      BRACKET_KEY,
      storedEvents([
        { type: "start", target: 4, entryIds: ["a", "b", "c", "d", "e"] },
        { type: "cutVote", entryId: "c", judge: 2, keep: true },
      ])
    );
    expect(button(`MCP: keep ${entry("c")}`).props["aria-pressed"]).toBe(true);
  });

  test("doesn't count a tap made on a tab that's behind another tab", async () => {
    const stored = stubStorage();
    await render(five());
    click("Start bracket");
    // The other tab's save lands, but its storage event hasn't arrived yet.
    const theirs = storedEvents([
      { type: "start", target: 4, entryIds: ["a", "b", "c", "d", "e"], judges: JUDGES },
      { type: "cutVote", entryId: "c", judge: 2, keep: true },
    ]);
    stored.set(BRACKET_KEY, theirs);
    click(`Fonso: keep ${entry("a")}`);
    // This tab shows their vote, drops its own tap, and says so.
    expect(button(`MCP: keep ${entry("c")}`).props["aria-pressed"]).toBe(true);
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(false);
    expect(stored.get(BRACKET_KEY)).toBe(theirs);
    expect(text()).toContain("Another tab changed the bracket");
    // Tapping again now counts, and clears the notice.
    click(`Fonso: keep ${entry("a")}`);
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(true);
    expect(text()).not.toContain("Another tab changed the bracket");
  });

  test("a tab that can't save keeps its votes when another tab saves", async () => {
    const stored = stubStorage();
    await render(five());
    click("Start bracket");
    const windowStub = globalThis.window as unknown as {
      localStorage: { setItem: () => void };
    };
    windowStub.localStorage.setItem = () => {
      throw new Error("quota");
    };
    click(`Fonso: keep ${entry("a")}`);
    expect(text()).toContain("This browser isn't saving the bracket");
    stored.otherTab(BRACKET_KEY, storedEvents([]));
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(true);
  });

  test("keeps the judges and entry numbers it started with", async () => {
    stubStorage();
    await render(five());
    click("Start bracket");
    click(`Fonso: keep ${entry("a")}`);
    // A host is renamed and the entries are reordered mid-bracket.
    await act(async () => {
      view.update(
        <QuotabungaRecordingRound
          episodeId="episode-1"
          judges={["Alfonso", "Harley", "MCP"]}
          onRefresh={vi.fn()}
          submissions={five().map((entry, index) => ({
            ...entry,
            bracketOrder: 5 - index,
          }))}
        />
      );
    });
    expect(button(`Fonso: keep ${entry("a")}`).props["aria-pressed"]).toBe(true);
    expect(() => button(`Alfonso: keep ${entry("a")}`)).toThrow();
  });

  test("starts over when the stored bracket can't be read", async () => {
    for (const value of [
      "{not json",
      JSON.stringify({ version: 1, events: [] }),
      storedEvents([{ type: "matchVote", judge: 0, side: "a" }]),
      // Parses, but isn't a bracket: 6 isn't a power of two.
      storedEvents([{ type: "start", target: 6, entryIds: ["a", "b", "c", "d", "e"] }]),
    ]) {
      stubStorage({ [BRACKET_KEY]: value });
      await render(five());
      // The round isn't stuck behind it: Start works.
      click("Start bracket");
      expect(text()).toContain("Cut round 1: 4 of 5 go through");
      act(() => view.unmount());
    }
    stubStorage();
    await render(five());
  });

  test("warns when the browser won't save the bracket, and still runs", async () => {
    const refuse = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", {
      localStorage: { getItem: refuse, setItem: refuse, removeItem: refuse },
    });
    await render(five());
    click("Start bracket");
    expect(text()).toContain("Cut round 1: 4 of 5 go through");
    expect(text()).toContain("This browser isn't saving the bracket");
  });

  test("each episode keeps its own bracket", async () => {
    const stored = stubStorage({
      [BRACKET_KEY]: storedEvents([
        { type: "start", target: 4, entryIds: ["a", "b", "c", "d", "e"] },
      ]),
    });
    await render(five());
    const before = stored.get(BRACKET_KEY);
    await rerender(five(), "episode-2");
    expect(text()).toContain("Start bracket");
    click("Start bracket");
    expect(stored.get(BRACKET_KEY)).toBe(before);
    expect(stored.has("bbpc-admin:quotabunga-bracket:episode-2")).toBe(true);
  });

  test("a finished bracket never replaces placements saved after it", async () => {
    stubStorage({ [BRACKET_KEY]: storedEvents(finishedFour) });
    const four = five().slice(0, 4);
    // The host saved a correction: b 2nd and a 3rd instead of the bracket's order.
    const saved = four.map((entry) =>
      entry.id === "c"
        ? { ...entry, placement: 1 as const }
        : entry.id === "b"
          ? { ...entry, placement: 2 as const }
          : entry.id === "a"
            ? { ...entry, placement: 3 as const }
            : entry
    );
    await render(saved);
    expect(text()).toContain("1st: #3 Source c2nd: #1 Source a3rd: #2 Source b");
    expect(placementsShown()["Placement for the Source b entry"]).toBe(2);
    // A refresh from the server doesn't bring the bracket's order back either.
    await rerender(saved.map((entry) => ({ ...entry })));
    expect(placementsShown()["Placement for the Source b entry"]).toBe(2);

    click("Use bracket results");
    expect(placementsShown()).toMatchObject({
      "Placement for the Source a entry": 2,
      "Placement for the Source b entry": 3,
      "Placement for the Source c entry": 1,
    });
    expect(text()).not.toContain("Use bracket results");
  });

  test("a result that comes back with its entries doesn't replace saved placements", async () => {
    stubStorage({ [BRACKET_KEY]: storedEvents(finishedFour) });
    const four = five().slice(0, 4);
    const saved = four.map((entry) =>
      entry.id === "d" ? { ...entry, placement: 1 as const } : entry
    );
    await render(saved);
    // An entry is excluded for a moment, then included again.
    await rerender(saved.slice(0, 3));
    expect(text()).toContain("included entries changed");
    await rerender(saved);
    expect(placementsShown()["Placement for the Source d entry"]).toBe(1);
    expect(text()).toContain("Use bracket results");
  });

  test("undoing or resetting a finished bracket brings the saved placements back", async () => {
    stubStorage();
    const four = five()
      .slice(0, 4)
      .map((entry) =>
        entry.id === "d" ? { ...entry, placement: 1 as const } : entry
      );
    await render(four);
    click("Start bracket");
    judgeMatchup("a", "a", "a");
    click("Next matchup");
    judgeMatchup("c", "c", "c");
    click("Next matchup");
    judgeMatchup("b", "b", "b");
    click("Next matchup");
    judgeMatchup("c", "c", "c");
    expect(placementsShown()["Placement for the Source c entry"]).toBe(1);

    click("Undo");
    expect(view.root.findAllByType("select")).toHaveLength(0);
    const reset = view.root
      .findAllByType(ConfirmModal)
      .find((node) => node.props.title === "Reset the bracket?");
    act(() => reset?.props.onConfirm());
    expect(placementsShown()).toMatchObject({
      "Placement for the Source c entry": "",
      "Placement for the Source d entry": 1,
    });
  });

  test("closes an open clip when the bracket moves on", async () => {
    stubStorage();
    await render(
      five().map((entry) => ({
        ...entry,
        clipUrl: `https://youtu.be/${entry.id.repeat(11)}`,
        clipStartSeconds: 1,
      }))
    );
    const play = view.root
      .findAllByType("button")
      .find((node) => /^Play clip/.test(textOf(node).trim()));
    act(() => play?.props.onClick());
    expect(view.root.findAllByType(QuoteClipPlayer)).toHaveLength(1);
    click("Start bracket");
    expect(view.root.findAllByType(QuoteClipPlayer)).toHaveLength(0);
  });

  test("closes a clip played on a decided matchup when moving on", async () => {
    stubStorage();
    await render(
      five()
        .slice(0, 4)
        .map((entry) => ({
          ...entry,
          clipUrl: `https://youtu.be/${entry.id.repeat(11)}`,
          clipStartSeconds: 1,
        }))
    );
    click("Start bracket");
    judgeMatchup("a", "a", "a");
    // Replay the loser's clip on the held result, then move on.
    const play = view.root
      .findAllByType("button")
      .filter((node) => /^Play clip/.test(textOf(node).trim()))
      .at(-1);
    act(() => play?.props.onClick());
    expect(view.root.findAllByType(QuoteClipPlayer)).toHaveLength(1);
    click("Next matchup");
    expect(view.root.findAllByType(QuoteClipPlayer)).toHaveLength(0);
  });

  test("offers a reset once the round's entries change", async () => {
    const stored = stubStorage({
      [BRACKET_KEY]: storedEvents([
        { type: "start", target: 4, entryIds: ["a", "b", "c", "d", "x"] },
      ]),
    });
    await render(five());
    expect(text()).toContain("included entries changed");
    expect(view.root.findAllByType("select")).toHaveLength(5);

    const reset = view.root
      .findAllByType(ConfirmModal)
      .find((node) => node.props.title === "Reset the bracket?");
    act(() => reset?.props.onConfirm());
    expect(text()).toContain("Start bracket");
    expect(stored.has(BRACKET_KEY)).toBe(false);
  });

  test("a round of fewer than 4 entries only offers placements", async () => {
    stubStorage();
    await render(five().slice(0, 3));
    expect(text()).toContain("A bracket needs at least 4 entries");
    expect(() => button("Start bracket")).toThrow();
    expect(view.root.findAllByType("select")).toHaveLength(3);
  });
});
