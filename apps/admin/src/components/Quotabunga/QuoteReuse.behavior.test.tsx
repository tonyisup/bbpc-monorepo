import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type * as QuotabungaAdapter from "@/convex/quotabunga";
import type { ConvexQuoteReuseReport } from "@/convex/quotabunga";

const mocks = vi.hoisted(() => ({
  client: {},
  load: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  query: { id: "quote-1" } as Record<string, string | undefined>,
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/router", () => ({ useRouter: () => ({ query: mocks.query }) }));
vi.mock("@/convex/quotabunga", async (importOriginal) => ({
  ...(await importOriginal<typeof QuotabungaAdapter>()),
  loadConvexAdminQuoteReuseReport: mocks.load,
}));

import { ConvexQuoteReusePage } from "./ConvexQuoteReusePage";
import { QuoteReuseChance } from "./QuoteReuseChance";

const user = { id: "user-1", name: "Listener", email: null, image: null };
const report: ConvexQuoteReuseReport = {
  submission: {
    id: "quote-1",
    quoteText: "Make him an offer",
    sourceTitle: "The Godfather",
    sourceType: "MOVIE",
    status: "INCLUDED",
    user,
    episode: { id: "episode-11", number: 11, title: "Now", status: "next" },
  },
  likelihood: 0.72,
  limited: true,
  episodes: [
    {
      episode: {
        id: "episode-9",
        number: 9,
        title: "Before",
        status: "published",
        date: "2026-01-09",
        slug: "before",
      },
      likelihood: 0.72,
      submissions: [
        {
          id: "quote-0",
          quoteText: "Make him an offer he can't refuse",
          sourceTitle: "Godfather",
          sourceType: "MOVIE",
          status: "INCLUDED",
          placement: 7,
          user: { ...user, name: "Earlier listener" },
          similarity: 0.81,
          sourceTitleMatches: false,
          likelihood: 0.4,
        },
      ],
      transcriptPassages: [
        {
          start: 3723,
          end: 3750,
          excerpt: "…make him an offer he can't refuse…",
          similarity: 1,
          likelihood: 0.72,
        },
      ],
    },
  ],
};

let renderer: ReactTestRenderer | null = null;

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
    await Promise.resolve();
  });
  if (renderer === null) {
    throw new Error("Nothing rendered.");
  }
  return renderer;
}

function text() {
  return JSON.stringify(renderer?.toJSON());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = { id: "quote-1" };
});

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = null;
});

describe("QuoteReuseChance", () => {
  test("links to the breakdown and shows the likelihood once it loads", async () => {
    mocks.load.mockResolvedValueOnce(report);
    const rendered = await render(
      <QuoteReuseChance quoteText="Make him an offer" submissionId="quote-1" />
    );

    expect(text()).toContain("72%");
    const link = rendered.root.findByType("a");
    expect(link.props.href).toBe("/quotabunga/reuse/quote-1");
    expect(link.props.className).toContain("text-destructive");
    expect(mocks.load).toHaveBeenCalledWith(mocks.client, "quote-1");
  });

  test("marks a failed check and shows a dash for a missing entry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.load.mockRejectedValueOnce(new Error("offline"));
    const rendered = await render(
      <QuoteReuseChance quoteText="Make him an offer" submissionId="quote-1" />
    );
    expect(text()).toContain("Reuse check failed");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();

    mocks.load.mockResolvedValueOnce(null);
    await act(async () => {
      rendered.update(
        <QuoteReuseChance quoteText="Edited quote" submissionId="quote-1" />
      );
      await Promise.resolve();
    });
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(text()).toContain("—");
    expect(text()).not.toContain("Reuse check failed");
  });

  test("ignores a slower response for text that has since been edited", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mocks.load
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve))
      )
      .mockResolvedValueOnce({ ...report, likelihood: 0.1 });
    const rendered = await render(
      <QuoteReuseChance quoteText="First" submissionId="quote-1" />
    );
    expect(text()).toContain("…");

    await act(async () => {
      rendered.update(<QuoteReuseChance quoteText="Second" submissionId="quote-1" />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveFirst(report);
      await Promise.resolve();
    });
    expect(text()).toContain("10%");
    expect(text()).not.toContain("72%");
  });
});

describe("ConvexQuoteReusePage", () => {
  test("shows the overall chance and each earlier episode's evidence", async () => {
    mocks.load.mockResolvedValueOnce(report);
    const rendered = await render(<ConvexQuoteReusePage />);
    const content = text();

    expect(content).toContain("Quote reuse breakdown");
    expect(content).toContain("estimated chance it was used before");
    expect(content).toContain("reached its candidate limit");
    expect(content).toContain("Episode 9 · Before");
    expect(content).toContain("Placement 7");
    expect(content).toContain("Different source title");
    expect(content).toContain("81%");
    expect(content).toContain("1:02:03");
    const hrefs = rendered.root
      .findAllByType("a")
      .map((link) => link.props.href as string);
    expect(hrefs).toContain("/episode/before");
    expect(hrefs).toContain("/quotabunga?episodeId=episode-11");
  });

  test("explains when no earlier use was found", async () => {
    mocks.load.mockResolvedValueOnce({
      ...report,
      likelihood: 0,
      limited: false,
      episodes: [],
    });
    await render(<ConvexQuoteReusePage />);
    expect(text()).toContain("No earlier use found");
    expect(text()).toContain("0%");
    expect(text()).not.toContain("candidate limit");
  });

  test("shows not found for a deleted entry and retries after an error", async () => {
    mocks.load.mockResolvedValueOnce(null);
    await render(<ConvexQuoteReusePage />);
    expect(text()).toContain("Entry not found");

    act(() => renderer?.unmount());
    mocks.load
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(report);
    const rendered = await render(<ConvexQuoteReusePage />);
    expect(text()).toContain("Reuse breakdown unavailable");

    // The error card's only button is Retry.
    const retry = rendered.root.findByType("button");
    await act(async () => {
      retry.props.onClick();
      await Promise.resolve();
    });
    expect(text()).toContain("Quote reuse breakdown");
  });

  test("waits for the route id before loading", async () => {
    mocks.query = {};
    await render(<ConvexQuoteReusePage />);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
