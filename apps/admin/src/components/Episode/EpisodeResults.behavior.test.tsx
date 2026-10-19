import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";

const mocks = vi.hoisted(() => ({
  client: {},
  seasons: vi.fn(),
  episodes: vi.fn(),
  quotes: vi.fn(),
  workbench: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/convex/seasons", () => ({
  loadConvexAdminSeasonsPage: mocks.seasons,
}));
vi.mock("@/convex/episodes", () => ({
  loadConvexAdminEpisodesPage: mocks.episodes,
}));
vi.mock("@/convex/quotabunga", () => ({
  loadConvexAdminQuoteSubmissions: mocks.quotes,
}));
vi.mock("@/convex/assignmentDetails", () => ({
  loadConvexAssignmentWorkbenchById: mocks.workbench,
}));
vi.mock("@/lib/dates", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPacificTodayPlainDate: () => "2026-03-01",
}));

import {
  EpisodeResultsPanel,
  EpisodeSeasonBadges,
  useEpisodeResults,
} from "./EpisodeResults";

const episode = {
  id: "episode-2",
  number: 201,
  date: "2026-01-12",
  assignments: [{ id: "assignment-1" }],
} as unknown as ConvexAdminEpisodeDetail;

const season = {
  id: "season-4",
  title: "Season 4",
  description: null,
  startedOn: "2026-01-01",
  endedOn: null,
  episodeCount: 10,
  gameType: {
    id: "game",
    title: "Main game",
    description: null,
    lookupId: "main",
  },
};

const user = (id: string, name: string) => ({ id, name, status: "active" });
const rating = (id: string, name: string, value: number) => ({
  id,
  name,
  value,
});

function quote(
  id: string,
  options: { placement?: 1 | 2 | 3; status?: string; awarded?: boolean }
) {
  return {
    id,
    quoteText: `Quote ${id}`,
    sourceTitle: "Heat",
    sourceType: "MOVIE",
    status: options.status ?? "INCLUDED",
    placement: options.placement ?? null,
    scored: options.awarded ?? false,
    point: options.awarded
      ? { id: `p-${id}`, adjustment: 3, reason: null }
      : null,
    createdAt: 1,
    user: { id: `u-${id}`, name: `Listener ${id}`, email: null, image: null },
  };
}

const workbench = {
  assignment: {
    id: "assignment-1",
    type: "HOMEWORK",
    playable: true,
    slug: "heat",
    user: { ...user("host-a", "Host A"), image: null },
    movie: { id: "movie", title: "Heat", year: 1995 },
  },
  reviews: [
    {
      id: "review-1",
      reviewer: user("host-a", "Host A"),
      rating: rating("slater", "Slater", 4),
      guesses: [
        {
          id: "guess-1",
          user: user("l1", "Listener One"),
          rating: rating("slater", "Slater", 4),
          hasPoint: true,
        },
        {
          id: "guess-2",
          user: user("l2", "Listener Two"),
          rating: rating("waste", "Waste", 2),
          hasPoint: false,
        },
      ],
    },
  ],
  wagers: [
    {
      id: "wager-1",
      points: 5,
      status: "won",
      user: user("l1", "Listener One"),
      targetUser: null,
      gamblingType: { id: "gt", title: "Over/under", multiplier: 2 },
      awardAdjustment: 10,
    },
  ],
};

let renderer: ReactTestRenderer;

function Harness({ revision = 0 }: { revision?: number }) {
  const state = useEpisodeResults(episode, revision);
  return (
    <div>
      <EpisodeSeasonBadges state={state} />
      <EpisodeResultsPanel episode={episode} onRetry={vi.fn()} state={state} />
    </div>
  );
}

function nodeText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(nodeText).join("");
}

function pageText(): string {
  return nodeText(renderer.root);
}

async function render() {
  await act(async () => {
    renderer = create(<Harness />);
  });
}

beforeEach(() => {
  mocks.seasons.mockResolvedValue({
    seasons: [season],
    isDone: true,
    continueCursor: "",
  });
  mocks.episodes.mockResolvedValue({
    episodes: [
      { number: 200, date: "2026-01-05" },
      { number: 201, date: "2026-01-12" },
    ],
    isDone: true,
    continueCursor: "",
  });
  mocks.quotes.mockResolvedValue([
    quote("q1", {}),
    quote("q2", { placement: 1 }),
    quote("q3", { status: "REJECTED" }),
  ]);
  mocks.workbench.mockResolvedValue(workbench);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("shows the season, quotes, guess results, and wagers", async () => {
  await render();

  const text = pageText();
  expect(text).toContain("#2 of 10 in Season 4");
  expect(text).toContain("Main game");
  expect(mocks.episodes).toHaveBeenCalledWith(mocks.client, null, {
    dateFrom: "2026-01-01",
    dateTo: undefined,
  });

  expect(text.indexOf("Quote q2")).toBeLessThan(text.indexOf("Quote q1"));
  expect(text.indexOf("Quote q1")).toBeLessThan(text.indexOf("Quote q3"));
  expect(text).toContain("Place #1");
  expect(text).not.toContain("Listener q2");
  expect(text).toContain("Name hidden");

  expect(text).toContain("Game results (2 guesses)");
  expect(text).toContain("Listener Oneguessed Slater");
  expect(text).toContain("Correct");
  expect(text).toContain("Wrong");
  expect(text).toContain("Awarded");

  expect(text).toContain("Wagers (1)");
  expect(text).toContain("5 points × 2 · Over/under");
  expect(text).toContain("won");
  expect(text).toContain("+10 pts");
});

test("shows listener names once the round is awarded", async () => {
  mocks.quotes.mockResolvedValue([
    quote("q2", { placement: 1, awarded: true }),
  ]);
  await render();

  expect(pageText()).toContain("Listener q2");
  expect(pageText()).toContain("Place #1 · 3 points");
});

test("explains when no season covers the episode", async () => {
  mocks.seasons.mockResolvedValue({
    seasons: [{ ...season, startedOn: "2026-02-01" }],
    isDone: true,
    continueCursor: "",
  });
  await render();

  expect(pageText()).toContain("No season");
  expect(pageText()).toContain("No season covers this episode's date.");
  expect(mocks.episodes).not.toHaveBeenCalled();
});

test("keeps the season when its episode list cannot load", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.episodes.mockRejectedValue(new Error("offline"));
  await render();

  expect(pageText()).toContain("Season 4");
  expect(pageText()).not.toContain("in Season 4");
  expect(pageText()).toContain("Wagers (1)");
});

test("offers a retry when an assignment disappears", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.workbench.mockResolvedValue(null);
  await render();

  expect(pageText()).toContain("The season and results could not be loaded.");
  expect(pageText()).not.toContain("Season 4");
});
