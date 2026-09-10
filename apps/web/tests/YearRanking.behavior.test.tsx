import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: {},
  reviews: vi.fn(),
  lists: vi.fn(),
  detail: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams("y=2026&view=list"),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/RatingIcon", () => ({ default: () => <span /> }));
vi.mock("@/components/UserTag", () => ({ default: () => <span /> }));
vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({
    status: "authenticated",
    accountStatus: "ready",
    user: { appUserId: "user-1", isAdmin: true },
  }),
}));
vi.mock("@/convex/identity", () => ({ getConvexDomainErrorCode: () => null }));
vi.mock("@/convex/year", () => ({
  listConvexYearReviews: mocks.reviews,
  listMyConvexMovieRankingLists: mocks.lists,
  getMyConvexMovieRankingList: mocks.detail,
  upsertConvexMovieRankingItem: mocks.upsert,
  removeConvexMovieRankingItem: mocks.remove,
  reorderConvexMovieRankingItems: mocks.reorder,
}));
vi.mock("motion/react", () => ({
  useDragControls: () => ({ start: vi.fn() }),
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
    Item: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  },
}));
import { ConvexYearPageClient } from "@/app/year/ConvexYearPageClient";

const movie = {
  id: "movie-1",
  title: "Arrival",
  year: 2016,
  poster: null,
  url: "https://example.test/movie",
  tmdbId: 329865,
};
const list = {
  id: "list-1",
  title: "Favorites",
  type: { name: "Top movies", maxItems: 10 },
  itemCount: 0,
  items: [],
};
let renderer: ReactTestRenderer;
function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function addButton() {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes("Add"));
  if (!found) throw new Error("Add button missing");
  return found;
}
async function renderRanking() {
  await act(async () => {
    renderer = create(<ConvexYearPageClient />);
  });
  await act(async () => {
    renderer.root
      .findByProps({ id: "ranked-list-selector" })
      .props.onChange({ target: { value: list.id } });
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.reviews.mockResolvedValue(
    [1, 2].map((id) => ({
      id: `review-${id}`,
      movie,
      reviewedAt: id,
      user: null,
      rating: null,
      episode: null,
    }))
  );
  mocks.lists.mockResolvedValue([list]);
  mocks.detail.mockResolvedValue(list);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

test("groups repeated movie reviews and saves only on submit, once while pending", async () => {
  const pending = deferred();
  mocks.upsert.mockReturnValue(pending.promise);
  await renderRanking();
  expect(
    renderer.root.findAllByProps({ id: "rank-select-movie-1" })
  ).toHaveLength(1);
  const label = renderer.root.findByProps({ htmlFor: "rank-select-movie-1" });
  expect(JSON.stringify(label.children)).toContain("Rank in");
  expect(addButton().props.disabled).toBe(true);
  act(() =>
    renderer.root
      .findByProps({ id: "rank-select-movie-1" })
      .props.onChange({ target: { value: "3" } })
  );
  expect(mocks.upsert).not.toHaveBeenCalled();
  const submit = addButton().props.onClick;
  act(() => {
    submit();
    submit();
  });
  expect(mocks.upsert).toHaveBeenCalledTimes(1);
  expect(mocks.upsert).toHaveBeenCalledWith(mocks.convex, {
    rankedListId: "list-1",
    movieId: "movie-1",
    rank: 3,
  });
  expect(
    renderer.root.findByProps({ id: "rank-select-movie-1" }).props.disabled
  ).toBe(true);
  await act(async () => {
    pending.resolve();
  });
  expect(mocks.detail).toHaveBeenCalledTimes(2);
});

test("failed rank save shows an error, keeps the selection, and permits retry", async () => {
  mocks.upsert
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  await renderRanking();
  act(() =>
    renderer.root
      .findByProps({ id: "rank-select-movie-1" })
      .props.onChange({ target: { value: "2" } })
  );
  await act(async () => {
    addButton().props.onClick();
  });
  expect(JSON.stringify(renderer.toJSON())).toContain(
    "The ranking change could not be saved."
  );
  expect(
    renderer.root.findByProps({ id: "rank-select-movie-1" }).props.value
  ).toBe("2");
  expect(addButton().props.disabled).toBe(false);
  await act(async () => {
    addButton().props.onClick();
  });
  expect(mocks.upsert).toHaveBeenCalledTimes(2);
});
