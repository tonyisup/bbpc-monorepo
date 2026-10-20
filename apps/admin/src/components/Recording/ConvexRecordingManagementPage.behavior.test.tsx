import type * as AssignmentDetailsModule from "../../convex/assignmentDetails";
import type * as EpisodeDetailsModule from "../../convex/episodeDetails";
import type * as QuotabungaModule from "../../convex/quotabunga";
import type * as RatingsModule from "../../convex/ratings";
import type * as SeasonsModule from "../../convex/seasons";
import type * as UsersModule from "../../convex/users";
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ConvexAdminSeasonGamblingEntry,
  ConvexAdminSeasonGuess,
} from "../../convex/seasonDetails";

const backend = vi.hoisted(() => ({
  guesses: [] as unknown[],
  wagers: [] as unknown[],
  // Holds every later load open, as a slow reload would.
  hold: false,
  mutation: vi.fn(async () => {
    throw new Error("not saved in tests");
  }),
}));

// One client for every render, as the real hook gives, so the page loads once.
const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("convex/react", () => ({
  useConvex: () => {
    client.current ??= {
      query: async (reference: unknown) => {
        if (backend.hold) return new Promise(() => undefined);
        const name = getFunctionName(reference as never);
        if (name === "games/guesses:listForAssignment") return backend.guesses;
        if (name === "games/gambling:listForAssignment") return backend.wagers;
        return [];
      },
      mutation: backend.mutation,
    };
    return client.current;
  },
}));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const HOSTS = ["MCP", "Fonso", "Harley"];
const emptyPage = { isDone: true, continueCursor: "" };

vi.mock("../../convex/quotabunga", async (importOriginal) => ({
  ...(await importOriginal<typeof QuotabungaModule>()),
  loadConvexAdminQuoteEpisodes: async () => [
    { id: "episode-1", number: 1, status: "recording" },
  ],
  loadConvexAdminQuoteSubmissions: async () => [],
}));
vi.mock("../../convex/seasons", async (importOriginal) => ({
  ...(await importOriginal<typeof SeasonsModule>()),
  loadConvexAdminSeasonsPage: async () => ({ ...emptyPage, seasons: [] }),
}));
vi.mock("../../convex/users", async (importOriginal) => ({
  ...(await importOriginal<typeof UsersModule>()),
  loadConvexAdminUsersPage: async () => ({
    ...emptyPage,
    users: HOSTS.map((id) => ({
      id,
      name: id,
      email: null,
      image: null,
      status: "active",
      isAdmin: true,
      roles: [],
    })),
  }),
}));
vi.mock("../../convex/ratings", async (importOriginal) => ({
  ...(await importOriginal<typeof RatingsModule>()),
  loadConvexAdminRatings: async () => [],
}));
vi.mock("../../convex/episodeDetails", async (importOriginal) => ({
  ...(await importOriginal<typeof EpisodeDetailsModule>()),
  loadConvexAdminEpisodeByNumber: async () => ({
    id: "episode-1",
    number: 1,
    title: "Pilot",
    status: "recording",
    slug: null,
    description: null,
    date: null,
    assignments: [
      {
        id: "assignment-1",
        type: "HOMEWORK",
        playable: true,
        slug: null,
        user: { id: "MCP", name: "MCP", image: null },
        movie: { id: "movie", title: "Movie", year: 2026 },
      },
    ],
  }),
  loadConvexAdminEpisodeAudioPage: async () => ({ ...emptyPage, messages: [] }),
}));
// Every host has rated, so the wagers are shown.
vi.mock("../../convex/assignmentDetails", async (importOriginal) => ({
  ...(await importOriginal<typeof AssignmentDetailsModule>()),
  loadConvexAssignmentWorkbenchById: async () => ({
    reviews: HOSTS.map((id) => ({
      id: `review-${id}`,
      reviewer: { id, name: id },
      rating: { id: "good", name: "Good", value: 4 },
    })),
  }),
}));

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConvexRecordingManagementPage } from "./ConvexRecordingManagementPage";

let view: ReactTestRenderer;

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const good = { id: "good", name: "Good", value: 4, sound: null, icon: null, category: null };
const season = {
  id: "season",
  title: "Season",
  description: null,
  startedOn: null,
  endedOn: null,
  gameType: { id: "game", title: "Game", description: null, lookupId: "game" },
};
const listener = { id: "listener", name: "Listener", image: null };

function guess(host: string, correct: boolean): ConvexAdminSeasonGuess {
  return {
    id: `guess-${host}`,
    createdAt: 1,
    user: listener,
    rating: correct ? good : { ...good, id: "bad" },
    assignmentReview: {
      id: `review-${host}`,
      assignment: {
        id: "assignment-1",
        type: "HOMEWORK",
        playable: true,
        episode: { id: "episode-1", number: 1, title: "Pilot", status: "recording", slug: null },
      },
      review: {
        id: `review-${host}`,
        user: { id: host, name: host, image: null, status: "active" },
        movie: { id: "movie", title: "Movie", year: 2026, poster: null, url: "movie", tmdbId: null },
        show: null,
        rating: good,
        reviewedAt: 1,
      },
    },
    season,
    point: null,
  };
}

function wager(
  title: string,
  lookupId: string,
  status: ConvexAdminSeasonGamblingEntry["status"],
  target: string | null = null
): ConvexAdminSeasonGamblingEntry {
  return {
    id: `wager-${title}`,
    points: 2,
    createdAt: 1,
    notes: null,
    status,
    user: listener,
    assignment: {
      id: "assignment-1",
      type: "HOMEWORK",
      playable: true,
      slug: null,
      user: { id: "MCP", name: "MCP", image: null, status: "active" },
      movie: { id: "movie", title: "Movie", year: 2026, poster: null, url: "movie", tmdbId: null },
      episode: { id: "episode-1", number: 1, title: "Pilot", status: "recording", slug: null },
    },
    gamblingType: {
      id: `type-${title}`,
      lookupId,
      title,
      description: null,
      multiplier: 2,
      isActive: true,
      createdAt: 1,
    },
    targetUser: target === null ? null : { id: target, name: target, image: null },
    season,
    awardPoint: null,
  };
}

afterEach(() => {
  act(() => view?.unmount());
  backend.mutation.mockClear();
});

const SUGGESTED = "Picked from the host ratings";

async function renderPage() {
  await act(async () => {
    view = create(<ConvexRecordingManagementPage />);
  });
  await act(async () => undefined);
}

/** A wager's row: the nearest element around its title that holds its status. */
function rowFor(title: string): ReactTestInstance {
  const label = view.root.find(
    (node) => node.type === "span" && textOf(node) === title
  );
  let row: ReactTestInstance | null = label;
  while (row !== null && row.findAllByType(Badge).length === 0) {
    row = row.parent;
  }
  if (row === null) throw new Error(`No wager row ${title}`);
  return row;
}

const buttonsIn = (row: ReactTestInstance) =>
  row
    .findAllByType(Button)
    .map((node) => [textOf(node).trim(), node.props.variant as string]);

afterEach(() => {
  backend.hold = false;
});

describe("Recording management wagers", () => {
  test("picks each open wager's outcome from the host ratings for the admin to confirm", async () => {
    // Value: protects=open wagers show Confirm won/lost from ratings, others stay plain; fails_when=outcome unwired, labels swapped, wrong guesses used; why_new=no test rendered wager rows; seam=none; no_claim=wager save result
    backend.guesses = [guess("MCP", true), guess("Fonso", true), guess("Harley", false)];
    backend.wagers = [
      wager("On MCP", "mcp-rating-guess-1x", "pending", "MCP"),
      wager("On Harley", "harley-rating-guess-1x", "locked", "Harley"),
      wager("Side bet", "bet", "pending"),
      wager("Settled", "all-rating-guess-3x", "won"),
    ];
    await renderPage();
    expect(buttonsIn(rowFor("On MCP"))).toEqual([
      ["Confirm won", "default"],
      ["Lost", "outline"],
      ["Reject", "ghost"],
    ]);
    expect(buttonsIn(rowFor("On Harley"))).toEqual([
      ["Won", "outline"],
      ["Confirm lost", "default"],
      ["Reject", "ghost"],
    ]);
    expect(buttonsIn(rowFor("Side bet"))).toEqual([
      ["Won", "outline"],
      ["Lost", "outline"],
      ["Reject", "ghost"],
    ]);
    // A wager that's already settled offers nothing to confirm.
    expect(buttonsIn(rowFor("Settled"))).toEqual([]);
    // The picked outcome says where it came from.
    expect(textOf(rowFor("On MCP"))).toContain(SUGGESTED);
    expect(textOf(rowFor("On Harley"))).toContain(SUGGESTED);
    expect(textOf(rowFor("Side bet"))).not.toContain(SUGGESTED);

    // Confirming still records the outcome the label names.
    const confirmLost = rowFor("On Harley")
      .findAllByType(Button)
      .find((node) => textOf(node).trim() === "Confirm lost");
    await act(async () => confirmLost?.props.onClick());
    expect(backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "wager-On Harley", status: "lost" })
    );
  });

  test("locks the wager buttons while the page reloads after a change", async () => {
    // Value: protects=a picked outcome can't be confirmed from ratings a reload is replacing; fails_when=wager buttons stay enabled while refreshing; why_new=no test held a reload open; seam=none; no_claim=reload result
    backend.guesses = [guess("MCP", true), guess("Fonso", true), guess("Harley", true)];
    backend.wagers = [wager("On MCP", "mcp-rating-guess-1x", "pending", "MCP")];
    await renderPage();
    expect(
      rowFor("On MCP").findAllByType(Button).map((node) => node.props.disabled)
    ).toEqual([false, false, false]);

    backend.hold = true;
    const refresh = view.root
      .findAllByType(Button)
      .find((node) => textOf(node).trim() === "Refresh");
    await act(async () => refresh?.props.onClick());
    // The suggestion stays put, so nothing jumps, but can't be confirmed yet.
    expect(buttonsIn(rowFor("On MCP"))[0]).toEqual(["Confirm won", "default"]);
    expect(
      rowFor("On MCP").findAllByType(Button).map((node) => node.props.disabled)
    ).toEqual([true, true, true]);
  });
});
