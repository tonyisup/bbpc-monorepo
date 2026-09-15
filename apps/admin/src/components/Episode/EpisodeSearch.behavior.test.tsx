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
  date: "2026-09-15",
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
  date: "2026-09-01",
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
  mocks.router.isReady = true;
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
async function changeDate(bound: "from" | "to", value: string) {
  await act(async () => {
    renderer.root
      .findByProps({ "aria-label": `Episode date ${bound}` })
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

test("restores bookmarked dates, resets pagination, and preserves the search when clearing dates", async () => {
  mocks.router.query = { from: "2026-09-01", to: "2026-09-15", keep: "yes" };
  await render();
  expect(
    renderer.root.findByProps({ "aria-label": "Episode date from" }).props.value
  ).toBe("2026-09-01");
  expect(
    renderer.root.findByProps({ "aria-label": "Episode date to" }).props.value
  ).toBe("2026-09-15");
  expect(mocks.client.query).toHaveBeenLastCalledWith(expect.anything(), {
    dateFrom: "2026-09-01",
    dateTo: "2026-09-15",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  await act(async () => {
    button("Load More").props.onClick();
  });
  expect(mocks.client.query).toHaveBeenLastCalledWith(expect.anything(), {
    dateFrom: "2026-09-01",
    dateTo: "2026-09-15",
    paginationOpts: { cursor: "second-page", numItems: 20 },
  });
  await changeDate("to", "2026-09-30");
  expect(mocks.client.query).toHaveBeenLastCalledWith(expect.anything(), {
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  expect(text()).not.toContain(second.title);
  await search("Interstellar");
  await tick(500);
  expect(mocks.router.replace).toHaveBeenLastCalledWith(
    {
      pathname: "/episode",
      query: {
        q: "Interstellar",
        from: "2026-09-01",
        to: "2026-09-30",
        keep: "yes",
      },
    },
    undefined,
    { shallow: true, scroll: false }
  );
  const transcriptCall = mocks.client.query.mock.calls.find(
    ([ref]) => getFunctionName(ref) === "episodes/transcripts:search"
  );
  expect(transcriptCall?.[1]).toEqual({
    query: "Interstellar",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
  });
  await act(async () => {
    button("Clear dates").props.onClick();
  });
  await tick(500);
  expect(mocks.router.replace).toHaveBeenLastCalledWith(
    { pathname: "/episode", query: { q: "Interstellar", keep: "yes" } },
    undefined,
    { shallow: true, scroll: false }
  );
  expect(text()).toContain(second.title);
});

test("blocks reversed and invalid ranges and recovers to an empty filtered list", async () => {
  await render();
  await changeDate("from", "2026-09-15");
  mocks.client.query.mockClear();
  await changeDate("to", "2026-09-01");
  expect(text()).toContain("start date must be on or before");
  expect(renderer.root.findAllByType("table")).toHaveLength(0);
  expect(mocks.client.query).not.toHaveBeenCalled();
  mocks.client.query.mockResolvedValueOnce({
    page: [],
    isDone: true,
    continueCursor: "done",
  });
  await changeDate("to", "2026-09-30");
  expect(text()).toContain("No episodes found in this date range.");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  mocks.client.query.mockClear();
  await act(async () => {
    mocks.router.query = { from: "2026-02-30" };
    renderer.update(<ConvexEpisodesPage />);
  });
  expect(text()).toContain("Enter valid dates");
  expect(mocks.client.query).not.toHaveBeenCalled();
});

test("external date navigation cancels pending URL writes and clearing search keeps the range", async () => {
  await render();
  await search("pending local search");
  await act(async () => {
    mocks.router.query = { from: "2026-09-01", q: "Interstellar" };
    renderer.update(<ConvexEpisodesPage />);
  });
  await tick(500);
  expect(mocks.router.replace).not.toHaveBeenCalled();
  await search("");
  await tick(500);
  expect(mocks.router.replace).toHaveBeenLastCalledWith(
    { pathname: "/episode", query: { from: "2026-09-01" } },
    undefined,
    { shallow: true, scroll: false }
  );
  expect(
    renderer.root.findByProps({ "aria-label": "Episode date from" }).props.value
  ).toBe("2026-09-01");
});

test("discards a pending browse page and transcript response when the date range changes", async () => {
  await render();
  let resolvePage!: (value: unknown) => void;
  mocks.client.query.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePage = resolve;
    })
  );
  await act(async () => {
    button("Load More").props.onClick();
  });
  await changeDate("from", "2026-09-15");
  await act(async () => {
    resolvePage({ page: [second], isDone: true, continueCursor: "done" });
  });
  expect(text()).not.toContain(second.title);
  expect(button("Load More").props.disabled).toBe(false);

  let resolveTranscript!: (value: unknown) => void;
  mocks.transcripts.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveTranscript = resolve;
    })
  );
  await search("jellyfish");
  await tick();
  await changeDate("from", "2026-09-16");
  await act(async () => {
    resolveTranscript({ results: [match], limited: false });
  });
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  expect(text()).not.toContain("jellyfish appears");
});

test("follows external query changes and clearing without replaying pending URL updates", async () => {
  mocks.router.query = { q: "Interstellar" };
  await render();
  expect(text()).toContain(second.title);

  await search("pending local search");
  await act(async () => {
    mocks.router.query = { q: "Underwater cinema" };
    renderer.update(<ConvexEpisodesPage />);
  });
  expect(
    renderer.root.findByProps({ "aria-label": "Search episodes" }).props.value
  ).toBe("Underwater cinema");
  expect(text()).toContain(first.title);
  expect(text()).not.toContain(second.title);
  await tick(500);
  expect(mocks.router.replace).not.toHaveBeenCalled();

  await search("another pending search");
  await act(async () => {
    mocks.router.query = {};
    renderer.update(<ConvexEpisodesPage />);
  });
  expect(
    renderer.root.findByProps({ "aria-label": "Search episodes" }).props.value
  ).toBe("");
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  expect(button("Load More")).toBeDefined();
  await tick(500);
  expect(mocks.router.replace).not.toHaveBeenCalled();
});

test("waits for router readiness before applying the URL query", async () => {
  mocks.router.isReady = false;
  mocks.router.query = { q: "Interstellar" };
  await render();
  expect(
    renderer.root.findByProps({ "aria-label": "Search episodes" }).props.value
  ).toBe("");

  await act(async () => {
    mocks.router.isReady = true;
    renderer.update(<ConvexEpisodesPage />);
  });
  expect(
    renderer.root.findByProps({ "aria-label": "Search episodes" }).props.value
  ).toBe("Interstellar");
  expect(text()).toContain(second.title);
});

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
