import type * as YouTubeModule from "@bbpc/youtube";
import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

vi.mock("convex/react", () => ({ useConvex: () => ({}) }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../Quotabunga/QuoteReuseChance", () => ({
  QuoteReuseChance: () => null,
}));
// An opened clip's player stays loading; these tests only check which opens.
vi.mock("@bbpc/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof YouTubeModule>()),
  loadYouTubeAPI: () => new Promise(() => undefined),
}));

import { QuoteClipPlayer } from "../Quotabunga/QuoteClipPlayer";
import { recordingOrder } from "../Quotabunga/recordingOrder";
import { QuotabungaRecordingRound } from "./ConvexRecordingManagementPage";

let view: ReactTestRenderer;

function submission(
  id: string,
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id,
    quoteText: `Quote ${id}`,
    sourceTitle: `Source ${id}`,
    sourceType: "MOVIE",
    clipUrl: null,
    clipStartSeconds: null,
    clipEndSeconds: null,
    listenerNotes: null,
    status: "INCLUDED",
    bracketOrder: null,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
    userId: `user-${id}`,
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: null,
    user: {
      id: `user-${id}`,
      name: `Listener ${id}`,
      email: null,
      image: null,
    },
    episode: {
      id: "episode-1",
      number: 1,
      title: "Pilot",
      status: "recording",
    },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const text = () => textOf(view.root);
const quotesInOrder = () =>
  view.root
    .findAllByType("blockquote")
    .map((node) => textOf(node).replace(/[“”]/g, ""));

async function render(submissions: ConvexAdminQuoteSubmission[]) {
  await act(async () => {
    view = create(
      <QuotabungaRecordingRound
        episodeId="episode-1"
        onRefresh={vi.fn()}
        submissions={submissions}
      />
    );
  });
}

afterEach(() => {
  act(() => view?.unmount());
  vi.unstubAllGlobals();
});

describe("Quotabunga recording round", () => {
  test("hides names until points are awarded, unless shown on purpose", async () => {
    await render([
      submission("a", { bracketOrder: 1 }),
      submission("b", { bracketOrder: 2 }),
    ]);
    expect(text()).not.toContain("Listener a");
    expect(text()).toContain("Name hidden");
    const select = view.root.findAllByType("select")[0];
    expect(select?.props["aria-label"]).toBe(
      "Placement for the Source a entry"
    );

    const toggle = view.root
      .findAllByType("button")
      .find((node) => textOf(node).includes("Show names"));
    act(() => toggle?.props.onClick());
    expect(text()).toContain("Listener a");
    expect(text()).toContain("Hide names");
  });

  test("shows names once any entry is scored, with no toggle", async () => {
    await render([
      submission("a", {
        bracketOrder: 1,
        placement: 1,
        scored: true,
        point: { id: "point-1", adjustment: 40, reason: null },
      }),
      submission("b", { bracketOrder: 2 }),
    ]);
    expect(text()).toContain("Listener a");
    expect(text()).toContain("Listener b");
    expect(text()).not.toContain("Show names");
  });

  test("shows listener and admin notes", async () => {
    await render([
      submission("a", {
        listenerNotes: "Said in the diner scene",
        adminNotes: "Audio is quiet; turn it up",
      }),
    ]);
    expect(text()).toContain("Listener: Said in the diner scene");
    expect(text()).toContain("Admin: Audio is quiet; turn it up");
  });

  test("plays randomized entries in bracket order, then the rest shuffled, never in submission order", async () => {
    const unbracketed = ["c", "d", "e", "f", "g", "h"].map((id) =>
      submission(id)
    );
    const entries = [
      ...unbracketed,
      submission("b", { bracketOrder: 2 }),
      submission("a", { bracketOrder: 1 }),
      submission("x", { status: "REJECTED" }),
    ];
    await render(entries);
    const order = quotesInOrder();
    expect(order.slice(0, 2)).toEqual(["Quote a", "Quote b"]);
    expect(order).toEqual(
      recordingOrder(entries, "episode-1").map((entry) => entry.quoteText)
    );
    expect(order.slice(2)).not.toEqual(
      unbracketed.map((entry) => entry.quoteText)
    );
    expect(order).not.toContain("Quote x");
  });

  test("plays one entry's clip at a time, in place", async () => {
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3001" },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    await render([
      submission("a", {
        bracketOrder: 1,
        clipUrl: "https://youtu.be/abcdefghijk?t=40",
        clipStartSeconds: 40,
        clipEndSeconds: 44,
      }),
      submission("b", {
        bracketOrder: 2,
        clipUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        clipStartSeconds: 10,
      }),
      submission("c", { bracketOrder: 3, clipUrl: "https://vimeo.com/1" }),
    ]);
    const clipButtons = () =>
      view.root
        .findAllByType("button")
        .filter((node) => /^Play clip (from|\d)/.test(textOf(node).trim()));
    const players = () =>
      view.root
        .findAllByType(QuoteClipPlayer)
        .map((node) => node.props.videoId as string);
    expect(clipButtons().map((node) => textOf(node).trim())).toEqual([
      "Play clip 0:40.0–0:44.0",
      "Play clip from 0:10.0",
    ]);
    // The Vimeo entry keeps its link but gets no player.
    expect(text()).toContain("Open clip");

    act(() => clipButtons()[0]?.props.onClick());
    expect(players()).toEqual(["abcdefghijk"]);
    act(() => clipButtons()[0]?.props.onClick());
    expect(players()).toEqual(["bbbbbbbbbbb"]);
    expect(clipButtons().map((node) => textOf(node).trim())).toEqual([
      "Play clip 0:40.0–0:44.0",
    ]);

    const close = view.root
      .findAllByType("button")
      .find((node) => textOf(node).trim() === "Close");
    act(() => close?.props.onClick());
    expect(players()).toEqual([]);
  });
});
