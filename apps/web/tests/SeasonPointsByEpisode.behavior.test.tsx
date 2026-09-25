import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ConvexSeasonPointsPage } from "@/convex/seasons";

const mocks = vi.hoisted(() => ({
  convex: {},
  loadPage: vi.fn<
    (client: unknown, seasonId: string, cursor: string | null) => Promise<unknown>
  >(),
}));

vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("@/convex/seasons", () => ({
  loadConvexSeasonPointsPage: mocks.loadPage,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img alt="" {...props} />,
}));
vi.mock("lucide-react", () => ({ ArrowRight: () => <svg /> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

import { SeasonPointsByEpisode } from "@/app/profile/seasons/[seasonId]/SeasonPointsByEpisode";

type Episode = { id: string; number: number; title: string; slug: string | null };

const episode418: Episode = {
  id: "ep-418",
  number: 418,
  title: "Episode 418",
  slug: "episode-418",
};
const episode417: Episode = {
  id: "ep-417",
  number: 417,
  title: "Episode 417",
  slug: null,
};

function point(id: string, episode: Episode | null, total: number) {
  return {
    id,
    reason: "Correct prediction",
    earnedAt: 1,
    adjustment: null,
    total,
    gamePointType: null,
    episode,
    assignment: null,
  };
}

function page(
  points: ReturnType<typeof point>[],
  isDone: boolean,
  continueCursor: string
): ConvexSeasonPointsPage {
  return { page: points, isDone, continueCursor };
}

let renderer: ReactTestRenderer | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPoints() {
  await act(async () => {
    renderer = create(<SeasonPointsByEpisode seasonId="season-1" />);
    await Promise.resolve();
  });
  await flush();
  if (renderer === null) {
    throw new Error("Points did not render.");
  }
  return renderer;
}

function text(rendered: ReactTestRenderer) {
  return JSON.stringify(rendered.toJSON());
}

function button(rendered: ReactTestRenderer, label: string) {
  const found = rendered.root
    .findAllByType("button")
    .find((candidate) => JSON.stringify(candidate.children).includes(label));
  if (found === undefined) {
    throw new Error(`No ${label} button rendered.`);
  }
  return found;
}

describe("SeasonPointsByEpisode", () => {
  beforeEach(() => {
    mocks.loadPage.mockReset();
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  test("shows an empty state for a season with no points", async () => {
    mocks.loadPage.mockResolvedValue(page([], true, ""));
    const rendered = await renderPoints();
    expect(text(rendered)).toContain("No points this season yet.");
    expect(mocks.loadPage).toHaveBeenCalledWith(mocks.convex, "season-1", null);
  });

  test("marks subtotals partial until the last page and appends older points", async () => {
    mocks.loadPage
      .mockResolvedValueOnce(page([point("p1", episode418, 3)], false, "c1"))
      .mockResolvedValueOnce(page([point("p2", episode417, -1)], true, ""));
    const rendered = await renderPoints();
    expect(text(rendered)).toContain("so far");
    expect(text(rendered)).toContain("Show older points");
    await act(async () => {
      button(rendered, "Show older points").props.onClick();
    });
    await flush();
    expect(mocks.loadPage).toHaveBeenLastCalledWith(mocks.convex, "season-1", "c1");
    const after = text(rendered);
    expect(after).toContain("Episode 418");
    expect(after).toContain("Episode 417");
    expect(after).not.toContain("so far");
    expect(after).not.toContain("Show older points");
  });

  test("offers a retry when a page fails, then recovers", async () => {
    mocks.loadPage
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([point("p1", null, 2)], true, ""));
    const rendered = await renderPoints();
    expect(text(rendered)).toContain("could not be loaded");
    await act(async () => {
      button(rendered, "Try again").props.onClick();
    });
    await flush();
    expect(text(rendered)).toContain("Season adjustments");
    expect(text(rendered)).not.toContain("could not be loaded");
  });

  test("treats a cursor that does not advance as a failure", async () => {
    mocks.loadPage
      .mockResolvedValueOnce(page([point("p1", episode418, 3)], false, "c1"))
      .mockResolvedValueOnce(page([], false, "c1"));
    const rendered = await renderPoints();
    await act(async () => {
      button(rendered, "Show older points").props.onClick();
    });
    await flush();
    expect(text(rendered)).toContain("could not be loaded");
  });
});
