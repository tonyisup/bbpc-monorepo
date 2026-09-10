import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: {},
  load: vi.fn(),
  initialize: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("@/convex/dashboard", () => ({
  loadConvexAdminDashboard: mocks.load,
  initializeConvexAdminDashboard: mocks.initialize,
}));
vi.mock("./GuessesGraph", () => ({ default: () => <div /> }));
import { ConvexAdminDashboard } from "./ConvexAdminDashboard";
const preparing = {
  countsReady: false,
  counts: null,
  guessStats: [],
  latestSyllabus: [],
  upcomingEpisode: null,
  latestEpisode: {
    id: "episode-1",
    number: 1,
    title: "Still available",
    date: null,
    description: null,
    assignments: [],
    extras: [],
  },
};
const ready = {
  ...preparing,
  countsReady: true,
  counts: { episodes: 120, users: 501, movies: 3001, reviews: 5000 },
};
let renderer: ReactTestRenderer | null = null;
async function render() {
  await act(async () => {
    renderer = create(<ConvexAdminDashboard userName="Alice" />);
  });
}
function text() {
  return JSON.stringify(renderer?.toJSON());
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue(undefined);
});
afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = null;
  vi.useRealTimers();
});

test("initializes once, hides incomplete episode projections, and stops polling when ready", async () => {
  mocks.load
    .mockResolvedValueOnce(preparing)
    .mockResolvedValueOnce(preparing)
    .mockResolvedValueOnce(ready);
  await render();
  expect(text()).toContain("Preparing dashboard totals…");
  expect(text()).not.toContain("Still available");
  expect(text()).toContain("Preparing episode summaries…");
  expect(text()).not.toContain("Total Movies");
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1999);
  });
  expect(mocks.load).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(text()).toContain("Still available");
  expect(text()).toContain("501");
  expect(text()).toContain("3001");
  expect(text()).not.toContain("Preparing dashboard totals…");
  expect(mocks.initialize).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(mocks.load).toHaveBeenCalledTimes(3);
});

test("initialization failure preserves the dashboard and supports an explicit retry", async () => {
  mocks.load.mockResolvedValue(preparing);
  mocks.initialize
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  await render();
  expect(text()).toContain("Dashboard totals could not be updated.");
  expect(text()).not.toContain("Still available");
  expect(text()).toContain("Preparing episode summaries…");
  const retry = renderer?.root
    .findAllByType("button")
    .find((node) => node.children.includes("Try again"));
  if (!retry) throw new Error("Retry button missing");
  await act(async () => {
    retry.props.onClick();
  });
  expect(mocks.initialize).toHaveBeenCalledTimes(2);
  expect(text()).toContain("Preparing dashboard totals…");
});

test("unmount cancels scheduled polling", async () => {
  mocks.load.mockResolvedValue(preparing);
  await render();
  act(() => renderer?.unmount());
  renderer = null;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(mocks.load).toHaveBeenCalledTimes(1);
});
