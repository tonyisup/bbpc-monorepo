import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ConvexSeasonSummary } from "@/convex/seasons";

const mocks = vi.hoisted(() => ({
  convex: {},
  latest: null as { key: string; change: number } | null,
  loadSeasons: vi.fn<(client: unknown, today: string) => Promise<unknown>>(),
  loadStanding: vi.fn<(client: unknown, seasonId: string) => Promise<unknown>>(),
}));

vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("@/convex/seasons", () => ({
  loadConvexSeasons: mocks.loadSeasons,
  loadConvexSeasonStanding: mocks.loadStanding,
}));
vi.mock("@/components/GamePointChange", () => ({
  useLatestPointChange: () => ({ latest: mocks.latest, loader: null }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("lucide-react", () => ({
  ArrowRight: () => <svg />,
  GamepadIcon: () => <svg />,
  Trophy: () => <svg />,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild: _asChild,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    asChild?: boolean;
    size?: string;
  }) => <span {...props}>{children}</span>,
}));

import { ConvexProfileSeasons } from "@/app/profile/ConvexProfileSeasons";

const current: ConvexSeasonSummary = {
  season: {
    id: "s12",
    title: "Season 12",
    startedOn: "2026-08-04",
    endedOn: null,
    episodeCount: 10,
  },
  isCurrent: true,
  total: 58,
  pointCount: 14,
  available: 42,
  recordedEpisodeCount: 6,
  standing: { rank: 3, playerCount: 11 },
};
const past: ConvexSeasonSummary = {
  season: {
    id: "s11",
    title: "Season 11",
    startedOn: "2026-06-02",
    endedOn: "2026-07-28",
    episodeCount: 10,
  },
  isCurrent: false,
  total: 71,
  pointCount: 22,
  available: null,
  recordedEpisodeCount: null,
  standing: null,
};

let renderer: ReactTestRenderer | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSeasons() {
  await act(async () => {
    renderer = create(<ConvexProfileSeasons appUserId="user-1" />);
    await Promise.resolve();
  });
  await flush();
  if (renderer === null) {
    throw new Error("Seasons did not render.");
  }
  return renderer;
}

function text(rendered: ReactTestRenderer) {
  return JSON.stringify(rendered.toJSON());
}

describe("ConvexProfileSeasons", () => {
  beforeEach(() => {
    mocks.latest = { key: "s12:2026-09-22:13", change: 13 };
    mocks.loadSeasons.mockReset();
    mocks.loadStanding.mockReset();
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  test("renders the current card, then fills in past standings", async () => {
    mocks.loadSeasons.mockResolvedValue([current, past]);
    let resolveStanding: (value: unknown) => void = () => undefined;
    mocks.loadStanding.mockReturnValue(
      new Promise((resolve) => {
        resolveStanding = resolve;
      })
    );
    const rendered = await renderSeasons();
    const before = text(rendered);
    expect(before).toContain("Season 12");
    expect(before).toContain("3rd");
    expect(before).toContain("of 11 players");
    expect(before).toContain("+13");
    expect(before).toContain("16 in open wagers");
    expect(before).toContain("Loading standing");
    expect(before).toContain("/profile/seasons/s11");
    expect(mocks.loadStanding).toHaveBeenCalledWith(mocks.convex, "s11");

    await act(async () => {
      resolveStanding({ rank: 2, playerCount: 12 });
      await Promise.resolve();
    });
    await flush();
    expect(text(rendered)).toContain("2nd of 12");
    expect(text(rendered)).not.toContain("Loading standing");
  });

  test("shows a dash when a past standing cannot be loaded", async () => {
    mocks.loadSeasons.mockResolvedValue([past]);
    mocks.loadStanding.mockRejectedValue(new Error("offline"));
    const rendered = await renderSeasons();
    expect(text(rendered)).toContain("Finished");
    expect(text(rendered)).toContain("\u2014");
  });

  test("explains an empty list and reports a failed load", async () => {
    mocks.loadSeasons.mockResolvedValueOnce([]);
    const rendered = await renderSeasons();
    expect(text(rendered)).toContain("No season is running right now");

    act(() => renderer?.unmount());
    renderer = null;
    mocks.loadSeasons.mockRejectedValueOnce(new Error("offline"));
    const failed = await renderSeasons();
    expect(text(failed)).toContain("Your seasons could not be loaded.");
  });
});
