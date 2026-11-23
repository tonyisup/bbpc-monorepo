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
  linkedPoints: vi.fn(),
  pointWorkbench: vi.fn(),
  removeQuote: vi.fn(),
  removeGuess: vi.fn(),
  removeWager: vi.fn(),
  removePoint: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
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
  deleteConvexAdminQuote: mocks.removeQuote,
}));
vi.mock("@/convex/assignmentDetails", () => ({
  loadConvexAssignmentWorkbenchById: mocks.workbench,
  removeConvexAssignmentGuess: mocks.removeGuess,
  removeConvexAssignmentWager: mocks.removeWager,
}));
vi.mock("@/convex/pointDetails", () => ({
  loadConvexAssignmentLinkedPoints: mocks.linkedPoints,
  loadConvexPointWorkbench: mocks.pointWorkbench,
  deleteConvexPoint: mocks.removePoint,
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

const linkedPoint = {
  linkId: "link-1",
  pointId: "point-1",
  user: { id: "l2", name: "Listener Two" },
  value: 2,
  reason: "Manual adjustment",
  pointTypeTitle: null,
  earnedAt: 1,
};

let renderer: ReactTestRenderer;

function Harness({ revision = 0 }: { revision?: number }) {
  const [resultsRevision, setResultsRevision] = React.useState(0);
  const state = useEpisodeResults(episode, revision, resultsRevision);
  return (
    <div>
      <EpisodeSeasonBadges state={state} />
      <EpisodeResultsPanel
        episode={episode}
        onEntryRemoved={() => setResultsRevision((value) => value + 1)}
        onRetry={vi.fn()}
        state={state}
      />
    </div>
  );
}

function removeButton(label: string): ReactTestInstance {
  return renderer.root.find(
    (node) => node.type === "button" && node.props["aria-label"] === label
  );
}

async function clickRemove(label: string) {
  await act(async () => {
    (removeButton(label).props.onClick as () => void)();
  });
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
  mocks.linkedPoints.mockResolvedValue([linkedPoint]);
  mocks.pointWorkbench.mockResolvedValue({
    point: { id: "point-1" },
    impact: {
      assignmentLinkCount: 1,
      guessCount: 0,
      gamblingEntryCount: 1,
      tagVoteCount: 0,
      quoteSubmissionCount: 0,
    },
  });
  mocks.removeQuote.mockResolvedValue(undefined);
  mocks.removeGuess.mockResolvedValue(undefined);
  mocks.removeWager.mockResolvedValue(undefined);
  mocks.removePoint.mockResolvedValue(undefined);
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("removes a wager after confirming its award and reloads in place", async () => {
  await render();
  const loads = mocks.workbench.mock.calls.length;

  await clickRemove("Remove wager by Listener One");

  expect(window.confirm).toHaveBeenCalledWith(
    "Delete Listener One's won wager of 5 points? Its +10 point award is removed from their total."
  );
  expect(mocks.removeWager).toHaveBeenCalledWith(
    mocks.client,
    workbench.wagers[0]
  );
  expect(mocks.toastSuccess).toHaveBeenCalledWith("Wager removed.");
  expect(mocks.workbench.mock.calls.length).toBeGreaterThan(loads);
  expect(pageText()).toContain("Wagers (1)");
  expect(removeButton("Remove wager by Listener One").props.disabled).toBe(
    false
  );
});

test("does nothing when a removal is not confirmed", async () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  await render();

  await clickRemove("Remove guess by Listener Two");

  expect(mocks.removeGuess).not.toHaveBeenCalled();
  expect(removeButton("Remove guess by Listener Two").props.disabled).toBe(
    false
  );
});

test("removes a guess against its assignment review", async () => {
  await render();

  await clickRemove("Remove guess by Listener Two");

  expect(mocks.removeGuess).toHaveBeenCalledWith(
    mocks.client,
    "review-1",
    workbench.reviews[0]?.guesses[1]
  );
});

test("names the award but not the listener in the quote confirmation", async () => {
  mocks.quotes.mockResolvedValue([
    quote("q2", { placement: 1, awarded: true }),
  ]);
  await render();

  await clickRemove("Remove quote");

  const message = vi.mocked(window.confirm).mock.calls[0]?.[0];
  expect(message).toContain("Quote q2");
  expect(message).toContain("+3 points");
  expect(message).not.toContain("Listener");
  expect(mocks.removeQuote).toHaveBeenCalled();
});

test("warns what a linked point is shared with before deleting it", async () => {
  await render();
  expect(pageText()).toContain("Assignment points (1)");

  await clickRemove("Remove point for Listener Two");

  expect(window.confirm).toHaveBeenCalledWith(
    "Delete this +2 point entry for Listener Two? It is also attached to 1 wager(s), which stay but lose this point."
  );
  expect(mocks.removePoint).toHaveBeenCalled();
});

test("reports a failed removal and re-enables the controls", async () => {
  mocks.removeWager.mockRejectedValue(new Error("offline"));
  await render();

  await clickRemove("Remove wager by Listener One");

  expect(mocks.toastError).toHaveBeenCalledWith(
    "The entry could not be removed."
  );
  expect(removeButton("Remove wager by Listener One").props.disabled).toBe(
    false
  );
});

test("keeps the results when linked points cannot load", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.linkedPoints.mockRejectedValue(new Error("offline"));
  await render();

  expect(pageText()).toContain("Wagers (1)");
  expect(pageText()).toContain("Assignment points could not be loaded.");
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
