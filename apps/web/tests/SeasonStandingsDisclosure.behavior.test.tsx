import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn<(reference: unknown, args: { today: string }) => unknown>(),
  accountStatus: "ready" as string,
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: { games: { member: { myLatestPointChange: "myLatestPointChange" } } },
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({ accountStatus: mocks.accountStatus }),
}));

vi.mock("@/components/GamePerformanceTracking", () => ({
  default: () => null,
}));

import { SeasonStandingsDisclosure } from "@/components/SeasonStandingsDisclosure";
import type { GamePerformanceData } from "@/types/game";

const LATEST = Date.parse("2026-09-11T04:00:00Z");

let renderer: ReactTestRenderer | null = null;

function summaryText(data: GamePerformanceData | null = null): string {
  act(() => {
    renderer = create(<SeasonStandingsDisclosure data={data} />);
  });
  const summary = renderer?.root.findByType("summary");
  const collect = (node: unknown): string =>
    typeof node === "string"
      ? node
      : typeof node === "object" && node !== null && "children" in node
      ? (node.children as unknown[]).map(collect).join("")
      : "";
  return collect(summary);
}

describe("SeasonStandingsDisclosure", () => {
  beforeEach(() => {
    const listeners = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    vi.stubGlobal("window", listeners);
    vi.stubGlobal("document", listeners);
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.unstubAllGlobals();
    mocks.useQuery.mockReset();
    mocks.accountStatus = "ready";
  });

  test("shows the member's last-episode points beside the standings", () => {
    mocks.useQuery.mockReturnValue({
      seasonId: "season-1",
      lastScoredAt: LATEST,
      points: [{ earnedAt: LATEST, pointValue: 5 }],
    });

    expect(summaryText()).toContain("+5");
  });

  test("shows a lost-points badge and no badge for a zero change", () => {
    mocks.useQuery.mockReturnValue({
      seasonId: "season-1",
      lastScoredAt: LATEST,
      points: [{ earnedAt: LATEST, pointValue: -3 }],
    });
    expect(summaryText()).toContain("-3 points last episode");

    act(() => renderer?.unmount());
    mocks.useQuery.mockReturnValue({
      seasonId: "season-1",
      lastScoredAt: LATEST,
      points: [
        { earnedAt: LATEST, pointValue: 3 },
        { earnedAt: LATEST, pointValue: -3 },
      ],
    });
    expect(summaryText()).not.toContain("last episode");
  });

  test("shows season progress beside the title", () => {
    mocks.accountStatus = "not-applicable";

    expect(
      summaryText({
        season: {
          id: "season-1",
          title: "Season 5",
          endedOn: null,
          episodeCount: 20,
        },
        recordedEpisodeCount: 7,
        userSummary: [],
        points: [],
      })
    ).toContain("7 of 20 episodes");
  });

  test("shows no badge for signed-out visitors", () => {
    mocks.accountStatus = "not-applicable";

    expect(summaryText()).not.toContain("last episode");
    expect(mocks.useQuery).not.toHaveBeenCalled();
  });
});
