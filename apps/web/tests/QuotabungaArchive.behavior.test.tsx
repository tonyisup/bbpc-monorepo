import type { AnchorHTMLAttributes, ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

const linkStatus = vi.hoisted(() => ({ pending: false }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("next/link", () => ({
  useLinkStatus: () => linkStatus,
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("lucide-react", () => ({
  ChevronDownIcon: () => <svg />,
  PlayIcon: () => <svg />,
  SquareIcon: () => <svg />,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: () => void;
  }) => (onClick ? <button onClick={onClick}>{children}</button> : <div>{children}</div>),
}));

import { ClipPlaybackProvider } from "@/app/game/quotabunga/ClipPlayback";
import QuotabungaArchiveError from "@/app/game/quotabunga/error";
import QuotabungaArchiveLoading from "@/app/game/quotabunga/loading";
import { QuotabungaChampionBand } from "@/app/game/quotabunga/QuotabungaChampionBand";
import { QuotabungaLedger } from "@/app/game/quotabunga/QuotabungaLedger";
import { QuotabungaRoundRow } from "@/app/game/quotabunga/QuotabungaRoundRow";
import { SeasonTabLabel } from "@/app/game/quotabunga/SeasonTabLabel";
import {
  archiveStats,
  clipDurationLabel,
  clipEmbedUrl,
  youtubeUrlOrNull,
  entryCountLabel,
  latestWinner,
  listenerRanks,
  leadEntry,
  listenerName,
  mergeListeners,
  placementLabel,
  quoted,
  seasonDateRange,
  selectSeasonView,
  sourceLabel,
} from "@/lib/quotabungaArchive";
import { getQuotabungaArchivePath } from "@/lib/routes";
import type {
  QuotabungaEntry,
  QuotabungaRound,
  QuotabungaSeason,
  QuotabungaSeasonDetail,
} from "@/types/quotabunga";

const YOUTUBE = "https://www.youtube.com/watch?v=abcdefghijk";
const OTHER_YOUTUBE = "https://www.youtube.com/watch?v=zyxwvutsrqp";

function entry(
  id: string,
  overrides: Partial<QuotabungaEntry> = {}
): QuotabungaEntry {
  return {
    id,
    quoteText: `Quote ${id}`,
    sourceTitle: `Source ${id}`,
    sourceType: "MOVIE",
    clipUrl: null,
    clipStartSeconds: null,
    clipEndSeconds: null,
    inBracket: true,
    placement: null,
    user: { id: `user-${id}`, name: `Listener ${id}` },
    ...overrides,
  };
}

function round(
  number: number,
  entries: QuotabungaEntry[],
  overrides: Partial<QuotabungaRound> = {}
): QuotabungaRound {
  return {
    episode: {
      id: `ep-${number}`,
      number,
      title: `Episode ${number}`,
      date: "2026-09-08",
      slug: `episode-${number}`,
    },
    state: "revealed",
    entryCount: entries.length,
    entries,
    ...overrides,
  };
}

const currentSeason: QuotabungaSeason = {
  id: "season-2",
  title: "Season 2",
  startedOn: "2026-07-01",
  endedOn: null,
  isCurrent: true,
};
const pastSeason: QuotabungaSeason = {
  id: "season-1",
  title: "Season 1",
  startedOn: "2026-01-01",
  endedOn: "2026-06-30",
  isCurrent: false,
};

const fullRound = round(12, [
  entry("win", {
    placement: 1,
    clipUrl: YOUTUBE,
    clipStartSeconds: 12.4,
    clipEndSeconds: 19.2,
  }),
  entry("second", { placement: 2, sourceType: "TV" }),
  entry("third", { placement: 3, clipUrl: "https://example.test/clip.mp4" }),
  entry("fourth", { user: { id: "user-fourth", name: null } }),
  entry("extra", { inBracket: false }),
]);

let renderer: ReactTestRenderer | null = null;

function render(element: React.ReactElement): ReactTestInstance {
  act(() => {
    renderer = create(element);
  });
  if (renderer === null) throw new Error("render failed");
  return renderer.root;
}

function text(node: ReactTestInstance | string): string {
  return typeof node === "string"
    ? node
    : node.children.map((child) => text(child)).join("");
}

function buttonNamed(root: ReactTestInstance, name: RegExp) {
  const match = root
    .findAllByType("button")
    .find((button) => name.test(text(button)));
  if (match === undefined) throw new Error(`No button matches ${String(name)}`);
  return match;
}

afterEach(() => {
  if (renderer !== null) {
    act(() => renderer?.unmount());
    renderer = null;
  }
});

describe("Quotabunga archive helpers", () => {
  test("falls back to the current season for unknown or missing season values", () => {
    const seasons = [currentSeason, pastSeason];
    expect(selectSeasonView(seasons, undefined)).toEqual({
      kind: "season",
      season: currentSeason,
    });
    expect(selectSeasonView(seasons, "season-1")).toEqual({
      kind: "season",
      season: pastSeason,
    });
    expect(selectSeasonView(seasons, "not-a-season")).toEqual({
      kind: "season",
      season: currentSeason,
    });
    expect(selectSeasonView(seasons, "all")).toEqual({ kind: "all" });
    expect(selectSeasonView([pastSeason], undefined)).toEqual({
      kind: "season",
      season: pastSeason,
    });
    expect(selectSeasonView([], "all")).toEqual({ kind: "none" });
    expect(getQuotabungaArchivePath()).toBe("/game/quotabunga");
    expect(getQuotabungaArchivePath("all")).toBe("/game/quotabunga?season=all");
  });

  test("formats places, quotes and season dates", () => {
    expect(placementLabel(1)).toBe("1st · 40 pts");
    expect(placementLabel(3)).toBe("3rd · 10 pts");
    expect(quoted(' "Already quoted." ')).toBe("“Already quoted.”");
    expect(quoted('"Gaston " How can you read this?')).toBe(
      "“Gaston \" How can you read this?”"
    );
    expect(quoted('""')).toBe("“\"\"”");
    expect(seasonDateRange(currentSeason)).toBe("Jul 2026 to now");
    expect(seasonDateRange(pastSeason)).toBe("Jan to Jun 2026");
    expect(
      seasonDateRange({ startedOn: "2025-11-01", endedOn: "2026-02-28" })
    ).toBe("Nov 2025 to Feb 2026");
    expect(seasonDateRange({ startedOn: null, endedOn: null })).toBe("");
  });

  test("totals revealed rounds only and finds the newest winner across seasons", () => {
    const current: QuotabungaSeasonDetail = {
      season: currentSeason,
      rounds: [
        round(14, [], { state: "open", entryCount: 3 }),
        round(13, [], { state: "locked", entryCount: 2 }),
        fullRound,
      ],
      listeners: [
        { user: { id: "user-win", name: "Winner" }, wins: 1, points: 40, entryCount: 1 },
        { user: { id: "user-second", name: "Second" }, wins: 0, points: 20, entryCount: 1 },
      ],
    };
    const past: QuotabungaSeasonDetail = {
      season: pastSeason,
      rounds: [round(5, [entry("old", { placement: 2 })])],
      listeners: [
        { user: { id: "user-second", name: "Second" }, wins: 2, points: 80, entryCount: 3 },
      ],
    };

    expect(archiveStats([current, past])).toEqual({
      rounds: 2,
      quotes: 6,
      listeners: 2,
    });
    expect(latestWinner([past, current])?.entry.id).toBe("win");
    // A round with no first place has no winner to feature.
    expect(latestWinner([past])).toBeNull();
    expect(latestWinner([{ ...current, rounds: current.rounds.slice(0, 2) }])).toBeNull();
    expect(mergeListeners([current, past])).toEqual([
      { user: { id: "user-second", name: "Second" }, wins: 2, points: 100, entryCount: 4 },
      { user: { id: "user-win", name: "Winner" }, wins: 1, points: 40, entryCount: 1 },
    ]);
  });

  test("features the highest-numbered round that has a first place", () => {
    const older = round(5, [entry("old-win", { placement: 1 })]);
    const newer = round(12, [entry("new-win", { placement: 1 })]);
    const detail = (rounds: QuotabungaRound[]): QuotabungaSeasonDetail => ({
      season: pastSeason,
      rounds,
      listeners: [],
    });
    for (const details of [
      [detail([older, newer])],
      [detail([newer, older])],
      [detail([older]), detail([newer])],
      [detail([newer]), detail([older])],
    ]) {
      expect(latestWinner(details)?.entry.id).toBe("new-win");
    }
  });

  test("orders merged listeners by wins, then points, then entries", () => {
    const tally = (
      id: string,
      wins: number,
      points: number,
      entryCount: number
    ) => ({ user: { id, name: id }, wins, points, entryCount });
    expect(
      mergeListeners([
        {
          season: pastSeason,
          rounds: [],
          listeners: [
            tally("b", 0, 60, 9),
            tally("a", 1, 40, 1),
            tally("c", 1, 40, 2),
            tally("d", 1, 50, 1),
          ],
        },
      ]).map((listener) => listener.user.id)
    ).toEqual(["d", "c", "a", "b"]);
  });

  test("only YouTube clip links survive loading", () => {
    expect(youtubeUrlOrNull(` ${YOUTUBE}&t=42s `)).toBe(`${YOUTUBE}&t=42s`);
    expect(youtubeUrlOrNull("https://youtu.be/abcdefghijk")).toBe(
      "https://youtu.be/abcdefghijk"
    );
    for (const other of [
      "https://example.test/clip.mp4",
      "https://youtube.com.evil.test/watch?v=abcdefghijk",
      "javascript:alert(1)",
      "clip",
      "",
    ])
      expect(youtubeUrlOrNull(other)).toBeNull();
    expect(youtubeUrlOrNull(null)).toBeNull();
  });

  test("listeners level on wins and points share a rank", () => {
    const tally = (wins: number, points: number, id: string) => ({
      user: { id, name: id },
      wins,
      points,
      entryCount: 1,
    });
    expect(
      listenerRanks([
        tally(2, 80, "a"),
        tally(1, 60, "b"),
        tally(1, 60, "c"),
        tally(1, 40, "d"),
        tally(0, 0, "e"),
      ])
    ).toEqual([1, 2, 2, 4, 5]);
    expect(listenerRanks([])).toEqual([]);
  });

  test("builds whole-second privacy embeds for YouTube clips only", () => {
    const [win, , third] = fullRound.entries;
    if (win === undefined || third === undefined) throw new Error("fixture");
    expect(clipDurationLabel(win)).toBe("0:07");
    expect(clipDurationLabel(third)).toBeNull();
    expect(clipEmbedUrl(win)).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0&start=12&end=20"
    );
    expect(
      clipEmbedUrl({
        clipUrl: `${YOUTUBE}&t=42s`,
        clipStartSeconds: null,
        clipEndSeconds: null,
      })
    ).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0&start=42"
    );
    expect(clipEmbedUrl(third)).toBeNull();
    expect(clipEmbedUrl(entry("none"))).toBeNull();
  });

  test("leaves out the parts of a clip range it cannot use", () => {
    const clip = (start: number | null, end: number | null, url = YOUTUBE) => ({
      clipUrl: url,
      clipStartSeconds: start,
      clipEndSeconds: end,
    });
    expect(clipDurationLabel(clip(10, 75))).toBe("1:05");
    // A range shorter than a second still reads as one second.
    expect(clipDurationLabel(clip(10, 10.2))).toBe("0:01");
    expect(clipDurationLabel(clip(10, 10))).toBeNull();
    expect(clipDurationLabel(clip(10, 4))).toBeNull();
    expect(clipDurationLabel(clip(null, 4))).toBeNull();

    const embed = "https://www.youtube-nocookie.com/embed/abcdefghijk";
    // A clip from the very top needs no start; an end before the start is dropped.
    expect(clipEmbedUrl(clip(0.4, 9))).toBe(`${embed}?autoplay=1&rel=0&end=9`);
    expect(clipEmbedUrl(clip(30, 12))).toBe(
      `${embed}?autoplay=1&rel=0&start=30`
    );
    // With no marked start, the end is measured against the link's own time.
    expect(clipEmbedUrl(clip(null, 50, `${YOUTUBE}&t=42s`))).toBe(
      `${embed}?autoplay=1&rel=0&start=42&end=50`
    );
    expect(clipEmbedUrl(clip(null, 30, `${YOUTUBE}&t=42s`))).toBe(
      `${embed}?autoplay=1&rel=0&start=42`
    );
  });

  test("names blank listeners, tags TV sources and escapes season links", () => {
    expect(listenerName("   ")).toBe("A listener");
    expect(listenerName(" Rob ")).toBe("Rob");
    expect(sourceLabel({ sourceTitle: "Lost", sourceType: "TV" })).toBe(
      "Lost (TV)"
    );
    expect(sourceLabel({ sourceTitle: "A play", sourceType: "OTHER" })).toBe(
      "A play"
    );
    expect(entryCountLabel(0)).toBe("0 entries");
    expect(quoted("“Curly quoted.”")).toBe("“Curly quoted.”");
    expect(quoted("  plain  ")).toBe("“plain”");
    expect(getQuotabungaArchivePath("a b&c")).toBe(
      "/game/quotabunga?season=a%20b%26c"
    );
  });

  test("has no winner to show for a revealed round without entries", () => {
    const hollow = round(9, []);
    expect(leadEntry(hollow)).toBeNull();
    expect(
      latestWinner([{ season: pastSeason, rounds: [hollow], listeners: [] }])
    ).toBeNull();
    expect(archiveStats([])).toEqual({ rounds: 0, quotes: 0, listeners: 0 });
    expect(mergeListeners([])).toEqual([]);
    // Listeners level on wins, points and entries fall back to their names.
    const tied = (id: string, name: string | null) => ({
      user: { id, name },
      wins: 1,
      points: 40,
      entryCount: 1,
    });
    expect(
      mergeListeners([
        {
          season: pastSeason,
          rounds: [],
          listeners: [tied("u-z", "Zed"), tied("u-none", null), tied("u-b", "Bea")],
        },
      ]).map((listener) => listener.user.id)
    ).toEqual(["u-none", "u-b", "u-z"]);
  });
});

describe("Quotabunga round rows", () => {
  test("an open round shows its count and the way in, never a quote", () => {
    const root = render(
      <QuotabungaRoundRow
        round={round(14, [], { state: "open", entryCount: 3 })}
      />
    );
    expect(text(root)).toContain(
      "3 entries so far. Quotes stay hidden until the episode is out."
    );
    expect(root.findAllByType("button")).toHaveLength(0);
    const links = root.findAllByType("a").map((link) => link.props.href);
    expect(links).toContain("/game#current-round-heading");

    const empty = render(
      <QuotabungaRoundRow
        round={round(15, [], { state: "open", entryCount: 0 })}
      />
    );
    expect(text(empty)).toContain("No entries yet.");
  });

  test("a locked round shows only how many entries are waiting", () => {
    const root = render(
      <QuotabungaRoundRow
        round={round(13, [], { state: "locked", entryCount: 1 })}
      />
    );
    expect(text(root)).toContain(
      "The winner shows up here once the episode is out."
    );
    expect(text(root)).toContain("1 entry");
    expect(text(root)).not.toContain("Submit your quote");
  });

  test("a revealed round leads with the winner and opens to every other entry", () => {
    const root = render(<QuotabungaRoundRow round={fullRound} />);
    expect(text(root)).toContain("“Quote win”");
    expect(text(root)).toContain("1st · 40 pts");
    expect(text(root)).not.toContain("Quote second");
    expect(
      root.findAllByType("a").map((link) => link.props.href)
    ).toContain("/episodes/episode-12");

    const toggle = buttonNamed(root, /5 entries/u);
    expect(toggle.props["aria-expanded"]).toBe(false);
    act(() => toggle.props.onClick());
    expect(toggle.props["aria-expanded"]).toBe(true);

    const shown = text(root);
    expect(shown).toContain("2nd · 20 pts");
    expect(shown).toContain("Source second (TV) · Listener second");
    expect(shown).toContain("3rd · 10 pts");
    expect(shown).toContain("In the bracket");
    expect(shown).toContain("A listener");
    expect(shown.indexOf("Also submitted")).toBeLessThan(
      shown.indexOf("Quote extra")
    );
    expect(shown).toContain("No clip");
    // A link to another site is never put on the page.
    expect(
      root
        .findAllByType("a")
        .some((link) => link.props.href === "https://example.test/clip.mp4")
    ).toBe(false);
  });

  test("a published round with no winner says so and still lists its entries", () => {
    const unawarded = round(9, [entry("a"), entry("b", { inBracket: false })]);
    expect(leadEntry(unawarded)).toBeNull();
    expect(
      latestWinner([{ season: pastSeason, rounds: [unawarded], listeners: [] }])
    ).toBeNull();

    const root = render(<QuotabungaRoundRow round={unawarded} />);
    expect(text(root)).toContain("No winner was recorded for this round.");
    expect(text(root)).not.toContain("Quote a");
    act(() => buttonNamed(root, /2 entries, show them/u).props.onClick());
    const shown = text(root);
    expect(shown).toContain("Quote a");
    expect(shown).toContain("Quote b");
    expect(shown).not.toContain("pts");
  });

  test("plays one clip at a time in place", () => {
    const root = render(<QuotabungaRoundRow round={fullRound} />);
    expect(root.findAllByType("iframe")).toHaveLength(0);
    act(() => buttonNamed(root, /0:07/u).props.onClick());
    const frames = root.findAllByType("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.props.src).toContain("youtube-nocookie.com/embed/abcdefghijk");
    act(() => buttonNamed(root, /Stop/u).props.onClick());
    expect(root.findAllByType("iframe")).toHaveLength(0);
  });

  test("a round ranked without a bracket has no bracket label or toggle when alone", () => {
    const ranked = render(
      <QuotabungaRoundRow
        round={round(11, [
          entry("a", { placement: 1 }),
          entry("b", { placement: 2 }),
          entry("c"),
        ])}
      />
    );
    act(() => buttonNamed(ranked, /3 entries/u).props.onClick());
    expect(text(ranked)).not.toContain("In the bracket");

    const single = render(
      <QuotabungaRoundRow
        round={round(10, [entry("only", { placement: 1 })], {
          episode: {
            id: "ep-10",
            number: 10,
            title: "Episode 10",
            date: null,
            slug: null,
          },
        })}
      />
    );
    expect(single.findAllByType("button")).toHaveLength(0);
    expect(single.findAllByType("a")).toHaveLength(0);
    expect(text(single)).toContain("1 entry");
  });

  test("starting another clip stops the one playing, and closing the round hides it", () => {
    const root = render(
      <QuotabungaRoundRow
        round={round(9, [
          // A clip with no marked range has no length to show.
          entry("lead", { placement: 1, clipUrl: YOUTUBE }),
          entry("next", {
            placement: 2,
            clipUrl: OTHER_YOUTUBE,
            clipStartSeconds: 3,
            clipEndSeconds: 8,
          }),
        ])}
      />
    );
    const toggle = buttonNamed(root, /2 entries/u);
    act(() => toggle.props.onClick());

    act(() => buttonNamed(root, /Play clip/u).props.onClick());
    expect(root.findAllByType("iframe").map((frame) => frame.props.src)).toEqual([
      "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&rel=0",
    ]);
    // The label carries the state, so the button is not also a toggle.
    expect(buttonNamed(root, /Stop/u).props["aria-pressed"]).toBeUndefined();

    act(() => buttonNamed(root, /0:05/u).props.onClick());
    const frames = root.findAllByType("iframe");
    expect(frames.map((frame) => frame.props.src)).toEqual([
      "https://www.youtube-nocookie.com/embed/zyxwvutsrqp?autoplay=1&rel=0&start=3&end=8",
    ]);
    expect(frames[0]?.props.title).toBe("Clip from Source next");
    expect(text(buttonNamed(root, /Stop/u))).toContain("Source next");

    act(() => toggle.props.onClick());
    expect(toggle.props["aria-expanded"]).toBe(false);
    expect(root.findAllByType("iframe")).toHaveLength(0);
    expect(text(root)).not.toContain("Quote next");

    // Opening the round again does not start the clip by itself.
    act(() => toggle.props.onClick());
    expect(toggle.props["aria-expanded"]).toBe(true);
    expect(root.findAllByType("iframe")).toHaveLength(0);
    expect(
      root.findAllByType("button").some((button) => /Stop/u.test(text(button)))
    ).toBe(false);
  });

  test("names each clip button for what it does", () => {
    const root = render(
      <QuotabungaRoundRow
        round={round(9, [
          entry("lead", { placement: 1, clipUrl: YOUTUBE }),
          entry("next", {
            placement: 2,
            clipUrl: OTHER_YOUTUBE,
            clipStartSeconds: 3,
            clipEndSeconds: 8,
          }),
        ])}
      />
    );
    act(() => buttonNamed(root, /2 entries/u).props.onClick());
    expect(text(buttonNamed(root, /Play clip/u))).toBe(
      "Play clip from Source lead"
    );
    expect(text(buttonNamed(root, /0:05/u))).toBe(
      "Play 0:05 clip from Source next"
    );
    act(() => buttonNamed(root, /0:05/u).props.onClick());
    expect(text(buttonNamed(root, /Stop/u))).toBe(
      "Stop the clip from Source next"
    );
  });

  test("a round with no first place leads with its best finisher", () => {
    const root = render(
      <QuotabungaRoundRow
        round={round(8, [
          entry("runner", { placement: 2 }),
          entry("third", { placement: 3 }),
        ])}
      />
    );
    const shown = text(root);
    expect(shown).toContain("“Quote runner”");
    expect(shown).toContain("2nd · 20 pts");
    expect(shown).not.toContain("Quote third");
    expect(shown).not.toContain("1st");
  });
});

describe("Quotabunga ledger and champion band", () => {
  const rounds = [14, 13, 12, 11].map((number) =>
    round(number, [entry(`w${number}`, { placement: 1 })])
  );

  test("keeps older rounds behind a disclosure or a link to the season", () => {
    const disclosed = render(
      <QuotabungaLedger rounds={rounds} initialCount={3} empty={<p>Empty</p>} />
    );
    expect(text(disclosed.findByType("summary"))).toContain(
      "Show 1 earlier round"
    );
    expect(text(disclosed.findByType("details"))).toContain("Quote w11");

    const linked = render(
      <QuotabungaLedger
        rounds={rounds}
        initialCount={3}
        moreHref="/game/quotabunga?season=season-2"
        empty={<p>Empty</p>}
      />
    );
    expect(linked.findAllByType("details")).toHaveLength(0);
    expect(text(linked)).not.toContain("Quote w11");
    expect(
      linked.findAllByType("a").map((link) => link.props.href)
    ).toContain("/game/quotabunga?season=season-2");

    const empty = render(
      <QuotabungaLedger rounds={[]} initialCount={3} empty={<p>Empty</p>} />
    );
    expect(text(empty)).toBe("Empty");
  });

  test("shows the latest winner beside the top three and the rest on request", () => {
    const [win] = fullRound.entries;
    if (win === undefined) throw new Error("fixture");
    const listeners = ["A", "B", "C", "D"].map((name, index) => ({
      user: { id: `user-${name}`, name },
      wins: 4 - index,
      points: (4 - index) * 40,
      entryCount: 5,
    }));
    const root = render(
      <QuotabungaChampionBand
        round={fullRound}
        entry={win}
        listeners={listeners}
        scope="Season 2"
      />
    );
    const shown = text(root);
    expect(shown).toContain("Latest winner · Ep. 12, Episode 12");
    expect(shown).toContain("Most wins · Season 2");
    expect(shown).toContain("4 wins · 160 pts");
    expect(shown).toContain("1 win · 40 pts");
    const summary = root.findByType("summary");
    expect(text(summary)).toContain("All 4 listeners");
    expect(text(summary)).toContain("Show fewer");
    act(() => buttonNamed(root, /0:07/u).props.onClick());
    expect(root.findAllByType("iframe")).toHaveLength(1);

    const few = render(
      <QuotabungaChampionBand
        round={fullRound}
        entry={win}
        listeners={listeners.slice(0, 3)}
        scope="All seasons"
      />
    );
    expect(few.findAllByType("details")).toHaveLength(0);
  });

  test("the champion band leaves out a link, clip or place it has nothing for", () => {
    const unlinked = {
      id: "ep-3",
      number: 3,
      title: "Episode 3",
      date: null,
      slug: null,
    };
    const plain = entry("plain", { user: { id: "user-plain", name: null } });
    const root = render(
      <QuotabungaChampionBand
        round={round(3, [plain], { episode: unlinked })}
        entry={plain}
        listeners={[
          { user: plain.user, wins: 0, points: 0, entryCount: 1 },
        ]}
        scope="Season 1"
      />
    );
    const shown = text(root);
    expect(shown).toContain("Latest winner · Ep. 3, Episode 3");
    expect(shown).toContain("Source plain · A listener");
    expect(shown).toContain("0 wins · 0 pts");
    expect(shown).not.toContain("1st");
    expect(root.findAllByType("a")).toHaveLength(0);
    expect(root.findAllByType("button")).toHaveLength(0);

    // A clip hosted somewhere other than YouTube is not offered at all.
    const hosted = entry("hosted", {
      placement: 1,
      clipUrl: "https://example.test/clip.mp4",
    });
    const linked = render(
      <QuotabungaChampionBand
        round={round(4, [hosted], { episode: { ...unlinked, id: "ep-4" } })}
        entry={hosted}
        listeners={[]}
        scope="Season 1"
      />
    );
    expect(linked.findAllByType("button")).toHaveLength(0);
    expect(linked.findAllByType("iframe")).toHaveLength(0);
    expect(linked.findAllByType("a")).toHaveLength(0);
    expect(text(linked)).toContain("No clip");
  });

  test("the wins board lists only winners up top and gives ties one rank", () => {
    const [win] = fullRound.entries;
    if (win === undefined) throw new Error("fixture");
    const tally = (name: string, wins: number, points: number) => ({
      user: { id: `user-${name}`, name },
      wins,
      points,
      entryCount: 2,
    });
    const root = render(
      <QuotabungaChampionBand
        round={fullRound}
        entry={win}
        listeners={[tally("Ada", 1, 40), tally("Bo", 0, 20), tally("Cy", 0, 20)]}
        scope="Season 2"
      />
    );
    const [top, rest] = root.findAllByType("ol");
    if (top === undefined || rest === undefined) throw new Error("lists");
    expect(text(top)).toContain("Ada");
    expect(text(top)).not.toContain("Bo");
    // Bo and Cy are level, so both are second.
    expect(rest.findAllByType("li").map((row) => text(row).slice(0, 3))).toEqual([
      "2Bo",
      "2Cy",
    ]);
    expect(text(root.findByType("summary"))).toContain("All 3 listeners");
  });

  test("the short list never stops partway through a tie", () => {
    const [win] = fullRound.entries;
    if (win === undefined) throw new Error("fixture");
    const tally = (name: string, wins: number, points: number) => ({
      user: { id: `user-${name}`, name },
      wins,
      points,
      entryCount: 1,
    });
    const root = render(
      <QuotabungaChampionBand
        round={fullRound}
        entry={win}
        listeners={[
          tally("Ada", 2, 80),
          ...["Bo", "Cy", "Di", "Ed"].map((name) => tally(name, 1, 40)),
          tally("Flo", 0, 20),
        ]}
        scope="Season 2"
      />
    );
    const [top, rest] = root.findAllByType("ol");
    if (top === undefined || rest === undefined) throw new Error("lists");
    // Four listeners share second place, so all four are shown.
    expect(top.findAllByType("li").map((row) => text(row).slice(0, 3))).toEqual([
      "1Ad",
      "2Bo",
      "2Cy",
      "2Di",
      "2Ed",
    ]);
    expect(rest.findAllByType("li")).toHaveLength(1);
    expect(top.props.role).toBe("list");
  });

  test("a long winning quote is set smaller and wider", () => {
    const long = entry("long", {
      placement: 1,
      quoteText: "word ".repeat(30).trim(),
    });
    const quoteClass = (element: React.ReactElement) =>
      String(
        render(element).find(
          (node) => node.type === "p" && text(node).startsWith("“")
        ).props.className
      );
    const band = (shown: QuotabungaEntry) => (
      <QuotabungaChampionBand
        round={round(7, [shown])}
        entry={shown}
        listeners={[]}
        scope="Season 2"
      />
    );
    expect(quoteClass(band(long))).toContain("max-w-[44ch]");
    expect(quoteClass(band(entry("short", { placement: 1 })))).toContain(
      "max-w-[20ch]"
    );
  });

  test("one clip plays at a time across the band and the rows", () => {
    const [win] = fullRound.entries;
    if (win === undefined) throw new Error("fixture");
    const root = render(
      <ClipPlaybackProvider>
        <QuotabungaChampionBand
          round={fullRound}
          entry={win}
          listeners={[]}
          scope="Season 2"
        />
        <QuotabungaRoundRow round={fullRound} />
      </ClipPlaybackProvider>
    );
    const plays = () =>
      root
        .findAllByType("button")
        .filter((button) => /0:07/u.test(text(button)));
    // The same winning clip is offered in the band and in its row.
    expect(plays()).toHaveLength(2);
    act(() => plays()[0]?.props.onClick());
    expect(root.findAllByType("iframe")).toHaveLength(1);
    // Starting it in the row moves playback there instead of doubling it.
    act(() => plays()[0]?.props.onClick());
    expect(root.findAllByType("iframe")).toHaveLength(1);
    expect(plays()).toHaveLength(1);
    act(() => buttonNamed(root, /Stop/u).props.onClick());
    expect(root.findAllByType("iframe")).toHaveLength(0);
  });

  test("the tapped season tab says it is loading", () => {
    linkStatus.pending = false;
    expect(text(render(<SeasonTabLabel>Season 2</SeasonTabLabel>))).toBe(
      "Season 2"
    );
    linkStatus.pending = true;
    const pending = render(<SeasonTabLabel>Season 2</SeasonTabLabel>);
    expect(text(pending)).toBe("Season 2 (loading)");
    expect(String(pending.findByType("span").props.className)).toContain(
      "animate-pulse"
    );
    linkStatus.pending = false;
  });

  test("the error page offers a retry and a way back", () => {
    let retried = 0;
    const root = render(
      <QuotabungaArchiveError
        error={new Error("boom")}
        reset={() => {
          retried += 1;
        }}
      />
    );
    expect(text(root)).toContain("The Quotabunga rounds could not load");
    expect(text(root)).not.toContain("boom");
    // The page failed on the server, so a retry has to fetch it again.
    router.refresh.mockClear();
    act(() => buttonNamed(root, /Try again/u).props.onClick());
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(retried).toBe(1);
    expect(root.findByType("a").props.href).toBe("/game");
  });

  test("counts several earlier rounds in the plural and announces loading", () => {
    const ledger = render(
      <QuotabungaLedger rounds={rounds} initialCount={2} empty={<p>Empty</p>} />
    );
    expect(text(ledger.findByType("summary"))).toContain(
      "Show 2 earlier rounds"
    );
    // Exactly the initial count leaves nothing to disclose.
    const exact = render(
      <QuotabungaLedger rounds={rounds} initialCount={4} empty={<p>Empty</p>} />
    );
    expect(exact.findAllByType("details")).toHaveLength(0);
    expect(text(exact)).toContain("Quote w11");

    const loading = render(<QuotabungaArchiveLoading />);
    expect(text(loading.findByProps({ role: "status" }))).toBe(
      "Loading Quotabunga"
    );
  });
});
