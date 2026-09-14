import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type {
  ConvexAdminEpisode,
  ConvexAdminEpisodesPage,
} from "@/convex/episodes";

const mocks = vi.hoisted(() => ({
  client: {},
  load: vi.fn(),
  error: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/convex/episodes", () => ({
  loadConvexAdminEpisodesPage: mocks.load,
  createConvexAdminEpisode: vi.fn(),
}));

import { ConvexEpisodesPage } from "./ConvexEpisodesPage";

let renderer: ReactTestRenderer;
const episode = (title: string): ConvexAdminEpisode => ({
  id: title,
  number: 123,
  title,
  recording: null,
  date: "2026-07-24",
  description: null,
  status: "published",
  slug: null,
  assignments: [],
  extras: [],
  links: [],
});
const page = (title: string, isDone = true): ConvexAdminEpisodesPage => ({
  episodes: [episode(title)],
  isDone,
  continueCursor: isDone ? "done" : `${title}-cursor`,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function nodeText(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(nodeText).join("");
}
function button(text: string) {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => nodeText(node) === text);
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
function setDates(from: string, to: string) {
  act(() => {
    renderer.root
      .findByProps({ id: "episode-date-from" })
      .props.onChange({ target: { value: from } });
    renderer.root
      .findByProps({ id: "episode-date-to" })
      .props.onChange({ target: { value: to } });
  });
}
async function apply() {
  await act(async () => {
    renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() });
  });
}
async function mount() {
  await act(async () => {
    renderer = create(<ConvexEpisodesPage />);
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(page("Unfiltered", false));
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

test("applies dates to the full catalog, retains them for Load More, and clears pagination", async () => {
  await mount();
  setDates("2026-07-01", "2026-07-31");
  expect(mocks.load).toHaveBeenCalledTimes(1);
  mocks.load.mockResolvedValueOnce(page("Filtered", false));
  await apply();
  const dateRange = { dateFrom: "2026-07-01", dateTo: "2026-07-31" };
  expect(mocks.load).toHaveBeenLastCalledWith(mocks.client, null, dateRange);
  expect(nodeText(renderer.root)).not.toContain("Unfiltered");
  mocks.load.mockResolvedValueOnce(page("Next filtered page"));
  await act(async () => {
    button("Load More").props.onClick();
  });
  expect(mocks.load).toHaveBeenLastCalledWith(
    mocks.client,
    "Filtered-cursor",
    dateRange
  );
  expect(nodeText(renderer.root)).toContain("Filtered");
  expect(nodeText(renderer.root)).toContain("Next filtered page");
  await act(async () => {
    button("Clear").props.onClick();
  });
  expect(mocks.load).toHaveBeenLastCalledWith(mocks.client, null, {});
  expect(
    renderer.root.findByProps({ id: "episode-date-from" }).props.value
  ).toBe("");
  expect(renderer.root.findByProps({ id: "episode-date-to" }).props.value).toBe(
    ""
  );
  expect(nodeText(renderer.root)).not.toContain("Next filtered page");
});

test.each([
  ["2026-07-01", "", { dateFrom: "2026-07-01" }],
  ["", "2026-07-31", { dateTo: "2026-07-31" }],
])("supports an open-ended range: %s to %s", async (from, to, expected) => {
  await mount();
  setDates(from as string, to as string);
  await apply();
  expect(mocks.load).toHaveBeenLastCalledWith(mocks.client, null, expected);
});

test("rejects a reversed range and shows an accessible explanation", async () => {
  await mount();
  setDates("2026-07-31", "2026-07-01");
  expect(button("Apply").props.disabled).toBe(true);
  expect(nodeText(renderer.root.findByProps({ role: "alert" }))).toBe(
    "From must be on or before To."
  );
  await apply();
  expect(mocks.load).toHaveBeenCalledTimes(1);
});

test("ignores the old first page when a range is applied while loading", async () => {
  const oldPage = deferred<ConvexAdminEpisodesPage>();
  mocks.load.mockReturnValueOnce(oldPage.promise);
  await mount();
  setDates("2026-07-01", "2026-07-31");
  mocks.load.mockResolvedValueOnce(page("New range"));
  await apply();
  await act(async () => {
    oldPage.resolve(page("Stale first page"));
  });
  expect(nodeText(renderer.root)).toContain("New range");
  expect(nodeText(renderer.root)).not.toContain("Stale first page");
});

test.each(["success", "failure"])(
  "ignores stale Load More %s after changing ranges",
  async (outcome) => {
    await mount();
    const oldPage = deferred<ConvexAdminEpisodesPage>();
    mocks.load.mockReturnValueOnce(oldPage.promise);
    act(() => {
      button("Load More").props.onClick();
    });
    setDates("2026-07-01", "2026-07-31");
    mocks.load.mockResolvedValueOnce(page("New range", false));
    await apply();
    const newPage = deferred<ConvexAdminEpisodesPage>();
    mocks.load.mockReturnValueOnce(newPage.promise);
    act(() => {
      button("Load More").props.onClick();
    });
    await act(async () => {
      if (outcome === "success") oldPage.resolve(page("Stale next page"));
      else oldPage.reject(new Error("Stale failure"));
    });
    expect(nodeText(renderer.root)).not.toContain("Stale next page");
    expect(mocks.error).not.toHaveBeenCalled();
    expect(button("Loading more...").props.disabled).toBe(true);
    await act(async () => {
      newPage.resolve(page("New next page"));
    });
    expect(nodeText(renderer.root)).toContain("New next page");
  }
);

test("shows a range-specific empty result and retries failures with the applied range", async () => {
  await mount();
  setDates("2026-07-01", "2026-07-31");
  mocks.load.mockRejectedValueOnce(new Error("Offline"));
  await apply();
  mocks.load.mockResolvedValueOnce({
    episodes: [],
    isDone: true,
    continueCursor: "done",
  });
  await act(async () => {
    button("Try again").props.onClick();
  });
  expect(mocks.load).toHaveBeenLastCalledWith(mocks.client, null, {
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  });
  expect(nodeText(renderer.root)).toContain(
    "No episodes found in this date range."
  );
});
