import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ConvexAdminSeasonGamblingEntry,
  ConvexAdminSeasonGuess,
  ConvexAdminSeasonPoint,
} from "@/convex/seasonDetails";
import type * as SeasonsAdapter from "@/convex/seasons";

const mocks = vi.hoisted(() => ({
  client: {},
  detail: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  performance: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  points: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
  loadConvexAdminSeasonPointsPage: mocks.points,
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
const points: ConvexAdminSeasonPoint[] = [
  { ...basePoint, id: "point-linked", episode: episode401 },
  { ...basePoint, id: "point-manual", total: -2, episode: null },
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

describe("ConvexSeasonDetailPage episode groups", () => {
  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.clearAllMocks();
  });

  test("groups activity by episode and links rows to their points", async () => {
    mocks.detail.mockResolvedValue({
      ...season,
      episodeCount: 20,
      counts: {
        points: { count: 2, isExact: true },
        guesses: { count: 2, isExact: true },
        gamblingEntries: { count: 2, isExact: true },
        quoteSubmissions: { count: 0, isExact: true },
      },
    });
    mocks.performance.mockResolvedValue({ userSummary: [], points: [] });
    mocks.points.mockResolvedValue(page(points, false));
    mocks.guesses.mockResolvedValue(page(guesses));
    mocks.gambling.mockResolvedValue(page(wagers));

    const rendered = await render();
    const text = textOf(rendered.toJSON());
    const hrefs = rendered.root
      .findAllByType("a")
      .map((link) => link.props.href as string);

    expect(text).toContain("Episode 401");
    expect(text).toContain("No episode");
    expect(text).toContain("+5 pts · 1 entry so far");
    expect(text).toContain("-2 pts · 1 entry so far");
    expect(text).toContain("2 guesses");
    expect(text).toContain("1 wager · 3 pts wagered");
    expect(text).toContain("20 episodes");
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/point/point-linked",
        "/point/point-manual",
        "/point/point-guess",
        "/point/point-wager",
      ])
    );
    expect(hrefs.filter((href) => href.startsWith("/point/"))).toHaveLength(4);
  });
});
