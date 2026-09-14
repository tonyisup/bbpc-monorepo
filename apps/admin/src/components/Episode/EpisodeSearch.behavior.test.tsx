import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({
  client: { query: vi.fn(), mutation: vi.fn() },
  router: {
    isReady: true,
    query: {} as Record<string, string>,
    pathname: "/episode",
    replace: vi.fn(),
  },
  transcripts: vi.fn(),
  writeText: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  storage: { getItem: vi.fn(), setItem: vi.fn() },
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/router", () => ({ useRouter: () => mocks.router }));
vi.mock("next/head", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
import { ConvexEpisodesPage } from "./ConvexEpisodesPage";

const base = {
  recording: null,
  date: null,
  description: null,
  status: "published",
  assignments: [],
  extras: [],
  links: [],
};
const first = {
  ...base,
  id: "canonical-first",
  number: 10,
  title: "Underwater cinema",
  slug: "underwater",
};
const movie = {
  id: "movie",
  title: "Interstellar",
  year: 2014,
  poster: null,
  url: "https://example.com/movie",
  tmdbId: null,
};
const second = {
  ...base,
  id: "canonical-second",
  number: 9,
  title: "Pending homework",
  slug: "pending",
  status: "pending",
  assignments: [
    {
      id: "assignment",
      type: "HOMEWORK",
      playable: false,
      slug: null,
      user: { id: "user", name: "Host", image: null },
      movie,
    },
  ],
};
const match = {
  episode: first,
  passages: [{ start: 3665, end: 3680, text: "A luminous jellyfish appears." }],
};
let renderer: ReactTestRenderer;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.router.query = {};
  mocks.router.replace.mockResolvedValue(true);
  mocks.storage.getItem.mockReturnValue(null);
  mocks.writeText.mockResolvedValue(undefined);
  mocks.transcripts.mockResolvedValue({ results: [], limited: false });
  mocks.client.query.mockImplementation(async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === "episodes/transcripts:search")
      return mocks.transcripts(args.query);
    if (name !== "episodes/admin:listPage")
      throw new Error(`Unexpected query ${name}`);
    return args.paginationOpts.cursor === null
      ? { page: [first], isDone: false, continueCursor: "second-page" }
      : { page: [second], isDone: true, continueCursor: "done" };
  });
  vi.stubGlobal("localStorage", mocks.storage);
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    renderer = create(<ConvexEpisodesPage />);
  });
}
async function search(value: string) {
  await act(async () => {
    renderer.root
      .findByProps({ "aria-label": "Search episodes" })
      .props.onChange({ target: { value } });
  });
}
async function tick(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function text() {
  return JSON.stringify(renderer.toJSON());
}
function button(label: string) {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes(label));
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

test("searches beyond the browse page, includes pending episodes, and restores browsing on clear", async () => {
  await render();
  expect(text()).toContain(first.title);
  expect(text()).not.toContain(second.title);
  await search("interstelar");
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  expect(text()).toContain(second.title);
  expect(text()).toContain("canonical-second");
  expect(renderer.root.findAllByType("mark").length).toBeGreaterThan(0);
  expect(renderer.root.findByProps({ href: "/episode/pending" })).toBeDefined();
  await act(async () => {
    renderer.root
      .findByProps({ type: "checkbox" })
      .props.onChange({ target: { checked: false } });
  });
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  expect(mocks.storage.setItem).toHaveBeenCalledWith(
    "bbpc-admin-episode-fuzzy-search",
    "false"
  );
  await act(async () => {
    renderer.root
      .findByProps({ "aria-label": "Clear episode search" })
      .props.onClick();
  });
  expect(text()).toContain(first.title);
  expect(button("Load More")).toBeDefined();
  await act(async () => {
    button("Load More").props.onClick();
  });
  expect(text()).toContain(second.title);
});

test("merges transcript matches, highlights prefixes, and preserves metadata on failure with retry", async () => {
  mocks.storage.getItem.mockReturnValue("false");
  mocks.transcripts.mockResolvedValue({ results: [match], limited: true });
  await render();
  await search("jelly");
  expect(mocks.transcripts).not.toHaveBeenCalled();
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  expect(renderer.root.findByType("mark").children).toEqual(["jellyfish"]);
  expect(text()).toContain("1:01:05");
  expect(text()).toContain("Automatically generated");
  expect(text()).toContain("Narrow your search");
  await search("cinema");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  mocks.transcripts.mockRejectedValueOnce(new Error("offline"));
  await search("underwater");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  expect(text()).toContain("Your title and movie results are still shown");
  await act(async () => {
    button("Retry transcript search").props.onClick();
  });
  await tick();
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
});

test("ignores late transcript responses after changes, revisits, and clearing", async () => {
  mocks.storage.getItem.mockReturnValue("false");
  let resolve!: (value: unknown) => void;
  mocks.transcripts.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  await search("jelly");
  await tick();
  await search("turtle");
  await tick();
  await act(async () => {
    resolve({ results: [match], limited: false });
  });
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  await search("jelly");
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  await search("");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  expect(text()).not.toContain("jellyfish appears");
});

test("loads bookmarked search, saves URL and fuzzy preference, and guards invalid transcript queries", async () => {
  mocks.router.query = { q: "Interstellar", keep: "yes" };
  mocks.storage.getItem.mockReturnValue("false");
  await render();
  expect(text()).toContain(second.title);
  expect(renderer.root.findByProps({ type: "checkbox" }).props.checked).toBe(
    false
  );
  await search("word ".repeat(17));
  await tick(500);
  expect(mocks.transcripts).not.toHaveBeenCalled();
  expect(text()).toContain("up to 16 words");
  expect(mocks.router.replace).toHaveBeenLastCalledWith(
    { pathname: "/episode", query: { keep: "yes", q: "word ".repeat(17) } },
    undefined,
    { shallow: true, scroll: false }
  );
  await search("canonical-second");
  expect(text()).toContain(second.title);
  await search("9");
  expect(text()).toContain(second.title);
  await search("");
  await tick(500);
  expect(mocks.router.replace).toHaveBeenLastCalledWith(
    { pathname: "/episode", query: { keep: "yes" } },
    undefined,
    { shallow: true, scroll: false }
  );
});

test("copies the full canonical ID and reports clipboard failure without losing the selectable ID", async () => {
  await render();
  const copy = () =>
    renderer.root.findByProps({
      "aria-label": "Copy episode ID canonical-first",
    });
  expect(
    renderer.root
      .findAllByType("code")
      .some((node) => node.children.includes(first.id))
  ).toBe(true);
  await act(async () => {
    copy().props.onClick();
  });
  expect(mocks.writeText).toHaveBeenCalledWith(first.id);
  expect(mocks.success).toHaveBeenCalledWith("Episode ID copied.");
  expect(text()).toContain("Copied");
  await tick(2000);
  mocks.writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => {
    copy().props.onClick();
  });
  expect(mocks.error).toHaveBeenCalledWith(
    expect.stringContaining("copy it manually")
  );
  expect(text()).toContain(first.id);
});

test("keeps transcript results when catalog loading fails and retries metadata independently", async () => {
  mocks.storage.getItem.mockReturnValue("false");
  mocks.transcripts.mockResolvedValue({ results: [match], limited: false });
  await render();
  mocks.client.query.mockRejectedValueOnce(new Error("catalog offline"));
  await search("jellyfish");
  await tick();
  expect(text()).toContain("Episode title and movie search is unavailable");
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  await act(async () => {
    button("Retry episode search").props.onClick();
  });
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(mocks.transcripts).toHaveBeenCalledTimes(1);
  await search("Interstellar");
  expect(text()).toContain(second.title);
});
