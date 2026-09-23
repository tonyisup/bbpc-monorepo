import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

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

const LATEST = Date.parse("2026-09-11T04:00:00Z");

let renderer: ReactTestRenderer | null = null;

function summaryText(): string {
  act(() => {
    renderer = create(<SeasonStandingsDisclosure data={null} />);
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
  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
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

  test("shows no badge for signed-out visitors", () => {
    mocks.accountStatus = "not-applicable";

    expect(summaryText()).not.toContain("+");
    expect(mocks.useQuery).not.toHaveBeenCalled();
  });
});
