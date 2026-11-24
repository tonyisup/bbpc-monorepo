import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: {},
  auth: {
    status: "authenticated" as "authenticated" | "unauthenticated" | "loading",
    accountStatus: "ready" as "ready" | "resolving",
    user: { appUserId: "user-1", isAdmin: false } as {
      appUserId: string | null;
      isAdmin: boolean;
      movieLinkPreference?: "imdb" | "tmdb";
    } | null,
  },
  params: new URLSearchParams("year=2026"),
  replace: vi.fn(),
  reviews: vi.fn(),
  list: vi.fn(),
  setScore: vi.fn(),
  add: vi.fn(),
  setUnseen: vi.fn(),
  clear: vi.fn(),
  orderTie: vi.fn(),
  track: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("motion/react", () => ({
  useDragControls: () => ({ start: vi.fn() }),
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
    Item: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  },
}));
vi.mock("@/components/LoadingIndicator", () => ({
  LoadingIndicator: ({ label }: { label: string }) => <p>{label}</p>,
}));
vi.mock("@/components/SignOutButton", () => ({
  default: () => <button>Sign out</button>,
}));
vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({
    ...mocks.auth,
    signIn: vi.fn(),
    refreshAccount: vi.fn(),
  }),
}));
vi.mock("@/convex/identity", () => ({ getConvexDomainErrorCode: () => null }));
vi.mock("@/lib/analytics", () => ({ track: mocks.track }));
vi.mock("@/convex/year", () => ({
  listConvexYearReviews: mocks.reviews,
  listMyConvexMovieRankingLists: vi.fn().mockResolvedValue([]),
  getMyConvexMovieRankingList: vi.fn(),
}));
vi.mock("@/convex/syllabus", () => ({
  searchConvexCatalogMovies: vi.fn().mockResolvedValue([]),
  searchConvexTmdbMovies: vi.fn().mockResolvedValue([]),
  upsertConvexTmdbMovie: vi.fn(),
}));
vi.mock("@/convex/scorecard", () => ({
  listConvexScorecard: mocks.list,
  setConvexScorecardScore: mocks.setScore,
  addConvexScorecardMovie: mocks.add,
  setConvexScorecardUnseen: mocks.setUnseen,
  clearConvexScorecardMovie: mocks.clear,
  orderConvexScorecardTie: mocks.orderTie,
  applyConvexScorecardToRankedList: vi.fn(),
  listConvexMovieRankingTypes: vi.fn().mockResolvedValue([]),
}));

import { ConvexScorecardPage } from "@/app/year/scorecard/ConvexScorecardPage";
import {
  buildScorecardCsv,
  buildScorecardMovies,
  getDefaultScorecardYear,
  isQueued,
  SCORECARD_CRITERIA,
  scoreFromTrackPosition,
  type ScorecardScores,
} from "@/lib/scorecard";

type Entry = {
  id: string;
  year: number;
  movie: {
    id: string;
    title: string;
    year: number;
    poster: string | null;
    url: string;
    tmdbId: number | null;
  };
  scores: ScorecardScores;
  unseen: boolean;
  complete: boolean;
  average: number | null;
  position: number | null;
  tied: boolean;
  myRating: null;
  createdAt: number;
  updatedAt: number;
};

function movie(id: string, title: string, year = 2026): Entry["movie"] {
  return {
    id,
    title,
    year,
    poster: null,
    url: `https://example.test/${id}`,
    tmdbId: null,
  };
}
function fullScores(value: number): ScorecardScores {
  return Object.fromEntries(SCORECARD_CRITERIA.map((c) => [c.key, value]));
}
function entry(
  m: Entry["movie"],
  scores: ScorecardScores,
  extra: Partial<Entry> = {}
): Entry {
  const values = SCORECARD_CRITERIA.map((c) => scores[c.key]);
  const complete = values.every((v) => v !== undefined);
  return {
    id: `entry-${m.id}`,
    year: 2026,
    movie: m,
    scores,
    unseen: false,
    complete,
    average: complete
      ? values.reduce<number>((a, b) => a + (b ?? 0), 0) / 9
      : null,
    position: null,
    tied: false,
    myRating: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}
function review(m: Entry["movie"], reviewedAt: number) {
  return {
    id: `review-${m.id}-${String(reviewedAt)}`,
    movie: m,
    user: null,
    rating: null,
    episode: null,
    reviewedAt,
  };
}

const early = movie("m-early", "Early Movie");
const late = movie("m-late", "Late Movie");

let renderer: ReactTestRenderer;
const text = () => JSON.stringify(renderer.toJSON());
function textOf(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
function buttonWith(label: string) {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => textOf(node).includes(label));
  if (!found) throw new Error(`No button with ${label}`);
  return found;
}
function cardTitle() {
  return renderer.root.findByType("h2").children.join("");
}
async function render() {
  await act(async () => {
    renderer = create(<ConvexScorecardPage />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = "authenticated";
  mocks.auth.accountStatus = "ready";
  mocks.auth.user = { appUserId: "user-1", isAdmin: false };
  mocks.params = new URLSearchParams("year=2026");
  // The late movie was reviewed first in the list order but later in time.
  mocks.reviews.mockResolvedValue([review(late, 200), review(early, 100)]);
  // A tiny fake server: setScore accumulates scores per movie.
  const server = new Map<string, Entry>();
  mocks.list.mockImplementation(() => Promise.resolve([...server.values()]));
  mocks.setScore.mockImplementation(
    (_client, input: { movieId: string; criterion: string; value: number }) => {
      const m = input.movieId === early.id ? early : late;
      const previous = server.get(m.id)?.scores ?? {};
      const next = entry(m, { ...previous, [input.criterion]: input.value });
      if (next.complete) next.position = 1;
      server.set(m.id, next);
      return Promise.resolve(next);
    }
  );
  mocks.setUnseen.mockImplementation(
    (_client, input: { movieId: string; unseen: boolean }) => {
      const m = input.movieId === early.id ? early : late;
      const next = {
        ...(server.get(m.id) ?? entry(m, {})),
        unseen: input.unseen,
      };
      server.set(m.id, next);
      return Promise.resolve(next);
    }
  );
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

describe("scorecard helpers", () => {
  test("defaults to last year from January through March", () => {
    // protects=default year rule; fails_when=the Jan 4 recording opens on the new year; no_claim=Pacific date derivation itself
    expect(getDefaultScorecardYear("2027-01-04")).toBe(2026);
    expect(getDefaultScorecardYear("2027-03-31")).toBe(2026);
    expect(getDefaultScorecardYear("2027-04-01")).toBe(2027);
    expect(getDefaultScorecardYear("2026-11-24")).toBe(2026);
  });

  test("snaps track positions to whole scores 1-10", () => {
    // protects=slider snapping; fails_when=ends or midpoints map outside 1-10; no_claim=pointer event wiring
    expect(scoreFromTrackPosition(-5, 100)).toBe(1);
    expect(scoreFromTrackPosition(0, 100)).toBe(1);
    expect(scoreFromTrackPosition(50, 100)).toBe(6);
    expect(scoreFromTrackPosition(100, 100)).toBe(10);
    expect(scoreFromTrackPosition(500, 100)).toBe(10);
    expect(scoreFromTrackPosition(10, 0)).toBe(1);
  });

  test("queues year movies by earliest review, then added movies by add time", () => {
    // protects=queue order; fails_when=added movies jump ahead or review order is ignored; no_claim=none beyond protects
    const added = movie("m-added", "Added", 2025);
    const items = buildScorecardMovies(
      [
        { movie: late, firstReviewedAt: 200 },
        { movie: early, firstReviewedAt: 100 },
      ],
      [entry(added, {}, { createdAt: 5 }), entry(late, fullScores(8))]
    );
    expect(items.map((item) => item.movie.id)).toEqual([
      "m-early",
      "m-late",
      "m-added",
    ]);
    expect(items.filter(isQueued).map((item) => item.movie.id)).toEqual([
      "m-early",
      "m-added",
    ]);
  });

  test("builds the CSV with ranked, incomplete and unseen rows in that order, quoting titles", () => {
    // protects=CSV rows/order/quoting (AC14); fails_when=untouched movies appear or a comma title breaks columns; no_claim=browser download
    const tricky = movie("m-q", 'Crouching Tiger, Hidden "Dragon"');
    const untouched = movie("m-u", "Untouched");
    const entries = [
      entry(movie("r2", "Ranked Two"), fullScores(7), { position: 2 }),
      entry(tricky, fullScores(9), { position: 1 }),
      entry(movie("r3", "Ranked Three"), fullScores(6), { position: 3 }),
      entry(movie("i1", "Incomplete"), { story: 5 }),
      entry(movie("u1", "Unseen"), {}, { unseen: true }),
    ];
    const csv = buildScorecardCsv(
      buildScorecardMovies([{ movie: untouched, firstReviewedAt: 1 }], entries)
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(
      "Position,Title,Year,Story,Performance,Emotion,Visual,Audio,Importance,Engagement,Fun,Replay,Score,Status"
    );
    expect(lines.slice(1).map((line) => line.split(",").at(-1))).toEqual([
      "ranked",
      "ranked",
      "ranked",
      "incomplete",
      "unseen",
    ]);
    expect(lines[1]).toBe(
      '1,"Crouching Tiger, Hidden ""Dragon""",2026,9,9,9,9,9,9,9,9,9,9.00,ranked'
    );
    expect(lines[4]).toBe(",Incomplete,2026,5,,,,,,,,,,incomplete");
    expect(csv).not.toContain("Untouched");
  });
});

describe("scorecard page", () => {
  test("asks signed-out visitors to sign in and loads nothing", async () => {
    // protects=signed-out gate (AC1); fails_when=scorecard data is requested without a session; no_claim=server-side auth
    mocks.auth.status = "unauthenticated";
    mocks.auth.user = null;
    await render();
    expect(text()).toContain("Sign in to use your scorecard");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  test("scores the earliest-reviewed movie first and moves on only via Next", async () => {
    // protects=queue start + Next-button rule; fails_when=card auto-advances on the 9th score or Next is enabled early; no_claim=pointer dragging
    await render();
    expect(cardTitle()).toBe("Early Movie");
    expect(buttonWith("Next movie").props.disabled).toBe(true);
    const sliders = () =>
      renderer.root.findAll(
        (node) => node.props.role === "slider" && node.type === "div"
      );
    expect(sliders()).toHaveLength(9);
    for (let index = 0; index < 9; index += 1) {
      await act(async () => {
        sliders()[index]?.props.onKeyDown({
          key: "8",
          preventDefault: vi.fn(),
        });
      });
    }
    expect(mocks.setScore).toHaveBeenCalledTimes(9);
    expect(mocks.setScore).toHaveBeenLastCalledWith(mocks.convex, {
      year: 2026,
      movieId: "m-early",
      criterion: "replay",
      value: 8,
    });
    expect(cardTitle()).toBe("Early Movie");
    expect(text()).toContain("8.00");
    expect(buttonWith("Next movie").props.disabled).toBe(false);
    await act(async () => {
      buttonWith("Next movie").props.onClick();
    });
    expect(cardTitle()).toBe("Late Movie");
  });

  test("the poster opens the movie page in a new tab, honoring the link preference", async () => {
    // protects=poster link; fails_when=the poster is not a new-tab link or ignores the TMDB preference; no_claim=browser tab behavior
    const tmdbMovie = { ...early, tmdbId: 42 };
    mocks.reviews.mockResolvedValue([review(tmdbMovie, 100)]);
    await render();
    const posterLink = () =>
      renderer.root.find(
        (node) =>
          node.type === "a" &&
          node.props["aria-label"] === "Open Early Movie in a new tab"
      );
    expect(posterLink().props).toMatchObject({
      href: "https://example.test/m-early",
      target: "_blank",
      rel: "noreferrer",
    });
    act(() => renderer.unmount());
    mocks.auth.user = {
      appUserId: "user-1",
      isAdmin: false,
      movieLinkPreference: "tmdb",
    };
    await render();
    expect(posterLink().props.href).toBe("https://www.themoviedb.org/movie/42");
  });

  test("an unscored slider has no value until set", async () => {
    // protects=no-handle unscored state; fails_when=an unscored criterion reports a value; no_claim=visual styling
    await render();
    const slider = renderer.root.findAll(
      (node) => node.props.role === "slider" && node.type === "div"
    )[0];
    expect(slider?.props["aria-valuenow"]).toBeUndefined();
    expect(slider?.props["aria-valuetext"]).toBe("Not scored");
  });

  test("Haven't seen marks the movie and moves to the next one", async () => {
    // protects=unseen flow; fails_when=the movie stays in the queue; no_claim=none beyond protects
    await render();
    await act(async () => {
      buttonWith("seen").props.onClick();
    });
    expect(mocks.setUnseen).toHaveBeenCalledWith(mocks.convex, {
      year: 2026,
      movieId: "m-early",
      unseen: true,
    });
    expect(cardTitle()).toBe("Late Movie");
    expect(textOf(renderer.root)).toContain("Haven't seen (1)");
  });

  test("opens on the leaderboard once something is ranked, with the top 10 line and tie badge", async () => {
    // protects=leaderboard rendering; fails_when=no top-10 divider or tied rows are unmarked; no_claim=drag reordering
    const ranked = Array.from({ length: 11 }, (_, index) =>
      entry(
        movie(`r${String(index)}`, `Ranked ${String(index + 1)}`),
        fullScores(9),
        {
          position: index + 1,
          average: 9 - index * 0.1,
          tied: index >= 9,
        }
      )
    );
    const last = ranked[10];
    const tenth = ranked[9];
    if (last && tenth) last.average = tenth.average;
    mocks.list.mockResolvedValue(ranked);
    await render();
    expect(text()).toContain("Top ");
    expect(text()).toContain("Tied");
    expect(text()).toContain("this tie crosses the top 10 line");
    // Ranked lists are an admin feature on /year, so the button follows suit.
    expect(() => buttonWith("Use as my top 10")).toThrow();
    act(() => renderer.unmount());
    mocks.auth.user = { appUserId: "user-1", isAdmin: true };
    await render();
    expect(buttonWith("Use as my top 10").props.disabled).toBe(false);
  });

  test("analytics never carry movie ids, titles or scores", async () => {
    // protects=analytics privacy rule; fails_when=a payload includes a movie id/title/score; no_claim=events outside this flow
    await render();
    const sliders = renderer.root.findAll(
      (node) => node.props.role === "slider" && node.type === "div"
    );
    for (const slider of sliders) {
      await act(async () => {
        slider.props.onKeyDown({ key: "7", preventDefault: vi.fn() });
      });
    }
    const events = mocks.track.mock.calls.map(([name]) => name);
    expect(events).toEqual(
      expect.arrayContaining(["scorecard_viewed", "scorecard_movie_completed"])
    );
    for (const [, payload] of mocks.track.mock.calls) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/m-early|m-late|Early Movie|Late Movie/u);
      expect(
        Object.keys(payload as object).every((key) =>
          ["year", "item_count"].includes(key)
        )
      ).toBe(true);
    }
  });
});
