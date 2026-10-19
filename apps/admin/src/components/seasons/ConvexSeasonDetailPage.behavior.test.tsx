import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ConvexAdminSeasonGamblingEntry,
  ConvexAdminSeasonGuess,
  ConvexAdminSeasonTimelineEpisode,
} from "@/convex/seasonDetails";
import type * as SeasonsAdapter from "@/convex/seasons";

const mocks = vi.hoisted(() => ({
  client: {},
  detail: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  performance: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  timeline: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  guesses: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  gambling: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/router", () => ({
  useRouter: () => ({ query: { id: "season-1" } }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("recharts", () => {
  const Stub = () => null;
  return {
    Area: Stub,
    AreaChart: Stub,
    CartesianGrid: Stub,
    Legend: Stub,
    ResponsiveContainer: Stub,
    Tooltip: Stub,
    XAxis: Stub,
    YAxis: Stub,
  };
});
// Render every tab panel so each feed can be checked.
vi.mock("../ui/tabs", () => {
  const Pass = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return { Tabs: Pass, TabsContent: Pass, TabsList: Pass, TabsTrigger: Pass };
});
vi.mock("@/convex/seasonDetails", () => ({
  loadConvexAdminSeasonDetail: mocks.detail,
  loadConvexAdminSeasonPerformance: mocks.performance,
  loadConvexAdminSeasonEpisodeTimeline: mocks.timeline,
  loadConvexAdminSeasonGuessesPage: mocks.guesses,
  loadConvexAdminSeasonGamblingPage: mocks.gambling,
}));
vi.mock("@/convex/seasons", async (importOriginal) => ({
  ...(await importOriginal<typeof SeasonsAdapter>()),
  loadConvexAdminGameTypes: async () => [],
}));

import { ConvexSeasonDetailPage } from "./ConvexSeasonDetailPage";

const gameType = {
  id: "game-type-1",
  title: "League",
  description: null,
  lookupId: "league",
};
const season = {
  id: "season-1",
  title: "Season 5",
  description: null,
  startedOn: "2026-09-01",
  endedOn: null,
  gameType,
};
const user = { id: "user-1", name: "Ada", image: null };
const reviewUser = { ...user, status: "active" as const };
const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://example.invalid/arrival",
  tmdbId: null,
};
const rating = {
  id: "rating-1",
  name: "Great",
  value: 4,
  sound: null,
  icon: null,
  category: null,
};
const episode401 = { id: "episode-401", number: 401, title: "Arrival" };
const episodeSummary = { ...episode401, status: "published", slug: null };

const basePoint = {
  user,
  season,
  reason: null,
  earnedAt: 100,
  adjustment: 5,
  gamePointType: null,
  total: 5,
};
const quietEpisode: ConvexAdminSeasonTimelineEpisode = {
  episode: {
    id: "episode-400",
    number: 400,
    title: "Quiet week",
    date: "2026-09-01",
    status: "published",
    slug: null,
  },
  points: { total: 0, count: 0 },
  guesses: { count: 0, scored: 0 },
  wagers: { count: 0, pointsWagered: 0, won: 0, lost: 0 },
  quotes: { count: 0 },
  players: [],
};
const timeline: ConvexAdminSeasonTimelineEpisode[] = [
  {
    episode: {
      ...episode401,
      date: "2026-09-08",
      status: "published",
      slug: "arrival",
    },
    points: { total: 13, count: 3 },
    guesses: { count: 2, scored: 1 },
    wagers: { count: 1, pointsWagered: 3, won: 1, lost: 0 },
    quotes: { count: 2 },
    players: [
      { user, total: 15 },
      { user: { id: "user-2", name: "Grace Hopper", image: null }, total: -2 },
    ],
  },
  quietEpisode,
];
const assignment = {
  id: "assignment-1",
  type: "HOMEWORK" as const,
  playable: true,
  slug: null,
  user: reviewUser,
  movie,
  episode: episodeSummary,
};
const baseGuess = {
  createdAt: 110,
  user,
  rating,
  assignmentReview: {
    id: "assignment-review-1",
    assignment: {
      id: "assignment-1",
      type: "HOMEWORK",
      playable: true,
      episode: episodeSummary,
    },
    review: {
      id: "review-1",
      user: reviewUser,
      movie,
      show: null,
      rating,
      reviewedAt: 90,
    },
  },
  season,
};
const guesses: ConvexAdminSeasonGuess[] = [
  { ...baseGuess, id: "guess-scored", point: { ...basePoint, id: "point-guess" } },
  { ...baseGuess, id: "guess-open", point: null },
];
const baseWager = {
  createdAt: 120,
  notes: null,
  user,
  gamblingType: {
    id: "gambling-type-1",
    lookupId: "double",
    title: "Double",
    description: null,
    multiplier: 2,
    isActive: true,
    createdAt: 1,
  },
  targetUser: null,
  season,
};
const wagers: ConvexAdminSeasonGamblingEntry[] = [
  {
    ...baseWager,
    id: "wager-won",
    points: 3,
    status: "won",
    assignment,
    awardPoint: { ...basePoint, id: "point-wager" },
  },
  {
    ...baseWager,
    id: "wager-open",
    points: 4,
    status: "pending",
    assignment: null,
    awardPoint: null,
  },
];

function page<T>(items: T[], isDone = true) {
  return { items, isDone, continueCursor: isDone ? "" : "next" };
}

let renderer: ReactTestRenderer | null = null;

async function render() {
  await act(async () => {
    renderer = create(<ConvexSeasonDetailPage />);
  });
  await act(() => Promise.resolve());
  if (renderer === null) {
    throw new Error("Season details did not render.");
  }
  return renderer;
}

function textOf(value: unknown): string {
  return JSON.stringify(value).replace(/","/gu, "");
}

const seasonDetail = {
  ...season,
  episodeCount: 20,
  counts: {
    points: { count: 3, isExact: true },
    guesses: { count: 2, isExact: true },
    gamblingEntries: { count: 2, isExact: true },
    quoteSubmissions: { count: 2, isExact: true },
  },
};

describe("ConvexSeasonDetailPage", () => {
  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.clearAllMocks();
  });

  test("shows the season's episodes so far with each one's game activity", async () => {
    mocks.detail.mockResolvedValue(seasonDetail);
    mocks.performance.mockResolvedValue({ userSummary: [], points: [] });
    mocks.timeline.mockResolvedValue(timeline);
    mocks.guesses.mockResolvedValue(page([]));
    mocks.gambling.mockResolvedValue(page([]));

    const rendered = await render();
    const text = textOf(rendered.toJSON());
    const hrefs = rendered.root
      .findAllByType("a")
      .map((link) => link.props.href as string);

    expect(mocks.timeline).toHaveBeenCalledWith(
      mocks.client,
      "season-1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u)
    );
    expect(text).toContain("Episode 401");
    expect(text).toContain(" · Arrival");
    expect(text).toContain("#2 of 20");
    expect(text).toContain("Sep 8, 2026");
    expect(text).toContain("+13");
    expect(text).toContain("3 awards");
    expect(text).toContain("1 scored");
    expect(text).toContain("3 pts · 1 won · 0 lost");
    const playerChips = rendered.root
      .findByProps({ "aria-label": "Points by player" })
      .findAllByType("li")
      .map((chip) =>
        chip
          .findAllByType("span")
          .flatMap((span) => span.children)
          .filter((child) => typeof child === "string")
          .join(" ")
      );
    expect(playerChips).toEqual(["A Ada +15", "GH Grace Hopper -2"]);
    expect(hrefs).toContain("/episode/arrival");
    expect(text).toContain("Episode 400");
    expect(text).toContain("#1 of 20");
    expect(text).toContain("No game activity recorded for this episode.");
    expect(text).not.toContain("No episode");
  });

  test("offers a retry when the episode timeline fails to load", async () => {
    mocks.detail.mockResolvedValue(seasonDetail);
    mocks.performance.mockResolvedValue({ userSummary: [], points: [] });
    mocks.timeline.mockRejectedValue(new Error("Unknown function"));
    mocks.guesses.mockResolvedValue(page([]));
    mocks.gambling.mockResolvedValue(page([]));

    const text = textOf((await render()).toJSON());

    expect(text).toContain("This activity feed could not be loaded.");
  });

  test("groups guesses and wagers by episode and links rows to their points", async () => {
    mocks.detail.mockResolvedValue(seasonDetail);
    mocks.performance.mockResolvedValue({ userSummary: [], points: [] });
    mocks.timeline.mockResolvedValue([]);
    mocks.guesses.mockResolvedValue(page(guesses));
    mocks.gambling.mockResolvedValue(page(wagers));

    const rendered = await render();
    const text = textOf(rendered.toJSON());
    const hrefs = rendered.root
      .findAllByType("a")
      .map((link) => link.props.href as string);

    expect(text).toContain("Episode 401");
    expect(text).toContain("No episode");
    expect(text).toContain("No episodes are dated in this season yet.");
    expect(text).toContain("2 guesses");
    expect(text).toContain("1 wager · 3 pts wagered");
    expect(text).toContain("20 episodes");
    expect(hrefs).toEqual(
      expect.arrayContaining(["/point/point-guess", "/point/point-wager"])
    );
    expect(hrefs.filter((href) => href.startsWith("/point/"))).toHaveLength(2);
  });
});
