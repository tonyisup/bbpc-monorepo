import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getConvexStandingsSeasons: vi.fn(),
  getConvexSeasonStandings: vi.fn(),
}));

vi.mock("@/server/convex/games", () => backend);
vi.mock("@/lib/dates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dates")>()),
  getPacificTodayPlainDate: () => "2026-09-10",
}));
vi.mock("@/components/GamePerformanceTracking", () => ({
  default: ({ showSummary }: { showSummary?: boolean }) => (
    <div data-chart={String(showSummary)} />
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
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

import StandingsArchiveError from "@/app/game/standings/error";
import StandingsArchivePage from "@/app/game/standings/page";
import {
  isSeasonFinished,
  joinNames,
  rankPlayers,
  selectStandingsSeason,
} from "@/lib/seasonStandings";
import type { GamePerformanceData, StandingsSeason } from "@/types/game";

const currentSeason: StandingsSeason = {
  id: "season-3",
  title: "Season 3",
  startedOn: "2026-07-01",
  endedOn: null,
  isCurrent: true,
};
const pastSeason: StandingsSeason = {
  id: "season-2",
  title: "Season 2",
  startedOn: "2026-01-01",
  endedOn: "2026-06-30",
  isCurrent: false,
};
const olderSeason: StandingsSeason = {
  id: "season-1",
  title: "Season 1",
  startedOn: "2025-07-01",
  endedOn: "2025-12-31",
  isCurrent: false,
};

function standings(
  season: StandingsSeason,
  userSummary: GamePerformanceData["userSummary"]
): GamePerformanceData {
  return {
    season: {
      id: season.id,
      title: season.title,
      endedOn: season.endedOn,
      episodeCount: 20,
    },
    recordedEpisodeCount: 20,
    userSummary,
    points: userSummary.map((player) => ({
      userId: player.id,
      earnedAt: Date.UTC(2026, 2, 1),
      pointValue: player.total,
    })),
  };
}

let renderer: ReactTestRenderer | null = null;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

function render(element: ReactElement): ReactTestInstance {
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

async function renderPage(season?: string | string[]) {
  return render(
    await StandingsArchivePage({
      searchParams: Promise.resolve(season === undefined ? {} : { season }),
    })
  );
}

describe("season standings helpers", () => {
  test("opens on the newest finished season unless another is asked for", () => {
    const seasons = [currentSeason, pastSeason, olderSeason];
    expect(selectStandingsSeason(seasons, undefined)).toBe(pastSeason);
    expect(selectStandingsSeason(seasons, "season-1")).toBe(olderSeason);
    expect(selectStandingsSeason(seasons, "season-3")).toBe(currentSeason);
    expect(selectStandingsSeason(seasons, "not-a-season")).toBe(pastSeason);
    expect(selectStandingsSeason([currentSeason], undefined)).toBe(
      currentSeason
    );
    expect(selectStandingsSeason([], "season-1")).toBeNull();
  });

  test("ranks by total and lets equal totals share a place", () => {
    expect(
      rankPlayers([
        { id: "c", name: "Cy", total: 7 },
        { id: "a", name: "Abe", total: 12 },
        { id: "b", name: "  ", total: 12 },
        { id: "d", name: null, total: -1 },
      ])
    ).toEqual([
      { id: "a", name: "Abe", total: 12, rank: 1 },
      { id: "b", name: "Player", total: 12, rank: 1 },
      { id: "c", name: "Cy", total: 7, rank: 3 },
      { id: "d", name: "Player", total: -1, rank: 4 },
    ]);
  });

  test("joins names and knows when a season is over", () => {
    expect(joinNames(["Abe"])).toBe("Abe");
    expect(joinNames(["Abe", "Bea"])).toBe("Abe and Bea");
    expect(joinNames(["Abe", "Bea", "Cy"])).toBe("Abe, Bea and Cy");
    expect(isSeasonFinished(pastSeason, "2026-07-01")).toBe(true);
    expect(isSeasonFinished(pastSeason, "2026-06-30")).toBe(false);
    expect(isSeasonFinished(currentSeason, "2030-01-01")).toBe(false);
  });
});

describe("season standings page", () => {
  beforeEach(() => {
    backend.getConvexStandingsSeasons.mockReset();
    backend.getConvexSeasonStandings.mockReset();
  });

  test("shows the newest finished season's champion and final standings", async () => {
    backend.getConvexStandingsSeasons.mockResolvedValue([
      currentSeason,
      pastSeason,
    ]);
    backend.getConvexSeasonStandings.mockResolvedValue(
      standings(pastSeason, [
        { id: "a", name: "Abe", total: 31 },
        { id: "b", name: "Bea", total: 24 },
      ])
    );

    const root = await renderPage();

    expect(backend.getConvexSeasonStandings).toHaveBeenCalledWith(
      "season-2",
      "2026-09-10"
    );
    const page = text(root);
    expect(page).toContain("Season 2 champion");
    expect(page).toContain("AbeJan to Jun 202631 pts");
    expect(
      root
        .findAllByType("tr")
        .slice(1)
        .map((row) => text(row))
    ).toEqual(["1stAbe31", "2ndBea24"]);
    expect(root.findByProps({ "aria-current": "page" }).props.href).toBe(
      "/game/standings?season=season-2"
    );
    // The page lists the standings itself, so the chart drops its table.
    expect(root.findByProps({ "data-chart": "false" })).toBeDefined();
  });

  test("calls a tied finish co-champions and the current season a lead", async () => {
    backend.getConvexStandingsSeasons.mockResolvedValue([
      currentSeason,
      pastSeason,
    ]);
    backend.getConvexSeasonStandings.mockResolvedValueOnce(
      standings(pastSeason, [
        { id: "a", name: "Abe", total: 9 },
        { id: "b", name: "Bea", total: 9 },
      ])
    );
    expect(text(await renderPage("season-2"))).toContain(
      "Season 2 co-championsAbe and Bea"
    );

    backend.getConvexSeasonStandings.mockResolvedValueOnce(
      standings(currentSeason, [{ id: "a", name: "Abe", total: 3 }])
    );
    const current = text(await renderPage("season-3"));
    expect(current).toContain("Leading so far");
    expect(current).not.toContain("champion");
  });

  test("only ever loads a season the backend listed", async () => {
    backend.getConvexStandingsSeasons.mockResolvedValue([pastSeason]);
    backend.getConvexSeasonStandings.mockResolvedValue(
      standings(pastSeason, [{ id: "a", name: "Abe", total: 1 }])
    );

    await renderPage(["season-1", "season-2"]);
    await renderPage("someone-elses-id");

    expect(
      backend.getConvexSeasonStandings.mock.calls.map(([seasonId]) => seasonId)
    ).toEqual(["season-2", "season-2"]);
  });

  test("says so when there are no seasons or no points yet", async () => {
    backend.getConvexStandingsSeasons.mockResolvedValue([]);
    expect(text(await renderPage())).toContain("No standings yet");
    expect(backend.getConvexSeasonStandings).not.toHaveBeenCalled();

    backend.getConvexStandingsSeasons.mockResolvedValue([currentSeason]);
    backend.getConvexSeasonStandings.mockResolvedValue(
      standings(currentSeason, [])
    );
    expect(text(await renderPage())).toContain("No points yet");

    // A season deleted between the two reads.
    backend.getConvexSeasonStandings.mockResolvedValue(null);
    expect(text(await renderPage())).toContain("No points yet");
  });

  test("the error page offers a retry without the error text", () => {
    const root = render(
      <StandingsArchiveError error={new Error("boom")} reset={() => {}} />
    );
    expect(text(root)).toContain("The season standings could not load");
    expect(text(root)).not.toContain("boom");
  });
});
