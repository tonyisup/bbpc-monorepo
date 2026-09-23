import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type * as DatesModule from "@/lib/dates";
import type * as SeasonsAdapter from "@/convex/seasons";
import type { ConvexAdminSeason } from "@/convex/seasons";

const mocks = vi.hoisted(() => ({
  client: {},
  loadSeasons: vi.fn<(client: unknown, cursor: string | null) => Promise<unknown>>(),
  loadGameTypes: vi.fn<(client: unknown) => Promise<unknown>>(),
  loadCatalog: vi.fn<
    (
      client: unknown,
      signal: AbortSignal,
      range: { dateFrom?: string; dateTo?: string }
    ) => Promise<unknown[]>
  >(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/dates", async (importOriginal) => ({
  ...(await importOriginal<typeof DatesModule>()),
  getPacificTodayPlainDate: () => "2026-09-23",
}));
vi.mock("@/convex/seasons", async (importOriginal) => ({
  ...(await importOriginal<typeof SeasonsAdapter>()),
  loadConvexAdminSeasonsPage: mocks.loadSeasons,
  loadConvexAdminGameTypes: mocks.loadGameTypes,
}));
vi.mock("@/convex/episodes", () => ({
  loadConvexAdminEpisodeSearchCatalog: mocks.loadCatalog,
}));

import { ConvexSeasonsPage } from "./ConvexSeasonsPage";

const gameType = {
  id: "game-type",
  title: "Predictions",
  description: null,
  lookupId: "predictions",
};
const zero = { count: 0, isExact: true };

function season(overrides: Partial<ConvexAdminSeason>): ConvexAdminSeason {
  return {
    id: "season",
    title: "Season",
    description: null,
    startedOn: "2026-09-01",
    endedOn: null,
    episodeCount: null,
    gameType,
    counts: {
      points: zero,
      guesses: zero,
      gamblingEntries: zero,
      quoteSubmissions: zero,
    },
    ...overrides,
  };
}

let renderer: ReactTestRenderer | null = null;

async function render(seasons: ConvexAdminSeason[]) {
  mocks.loadSeasons.mockResolvedValue({
    seasons,
    isDone: true,
    continueCursor: "",
  });
  await act(async () => {
    renderer = create(<ConvexSeasonsPage />);
  });
  await act(() => Promise.resolve());
  return JSON.stringify(renderer?.toJSON()).replace(/","/gu, "");
}

describe("ConvexSeasonsPage season progress", () => {
  beforeEach(() => {
    mocks.loadGameTypes.mockResolvedValue([gameType]);
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.clearAllMocks();
  });

  test("counts episodes only for the active fixed-length season", async () => {
    mocks.loadCatalog.mockResolvedValue(new Array(7).fill({}));

    const text = await render([
      season({ id: "active", title: "Season 5", episodeCount: 20 }),
      season({ id: "open", title: "Open season" }),
      season({
        id: "ended",
        title: "Season 4",
        startedOn: "2026-01-01",
        endedOn: "2026-08-31",
        episodeCount: 20,
      }),
    ]);

    expect(mocks.loadCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.loadCatalog.mock.calls[0]?.[2]).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-23",
    });
    expect(text).toContain("7 of 20 recorded");
    expect(text).toContain("20 episodes");
    expect(text).not.toContain("Set an end date");
  });

  test("asks for an end date once every episode is dated", async () => {
    mocks.loadCatalog.mockResolvedValue(new Array(20).fill({}));

    const text = await render([
      season({ id: "active", title: "Season 5", episodeCount: 20 }),
    ]);

    expect(text).toContain("20 of 20 recorded");
    expect(text).toContain("Set an end date once the final episode has recorded");
  });

  test("leaves progress out when the episode count fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.loadCatalog.mockRejectedValue(new Error("offline"));

    const text = await render([
      season({ id: "active", title: "Season 5", episodeCount: 20 }),
    ]);

    expect(text).toContain("Season 5");
    expect(text).not.toContain("recorded");
  });
});
