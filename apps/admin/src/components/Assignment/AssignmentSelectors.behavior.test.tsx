import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: {},
  users: vi.fn(),
  seasons: vi.fn(),
  workbench: vi.fn(),
  audio: vi.fn(),
  ratings: vi.fn(),
  review: vi.fn(),
  guess: vi.fn(),
  error: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/router", () => ({
  useRouter: () => ({ query: { slug: "assignment-one" } }),
}));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/convex/users", () => ({ loadConvexAdminUsersPage: mocks.users }));
vi.mock("@/convex/seasons", () => ({
  loadConvexAdminSeasonsPage: mocks.seasons,
}));
vi.mock("@/convex/ratings", () => ({ loadConvexAdminRatings: mocks.ratings }));
vi.mock("@/convex/identity", () => ({ getConvexDomainErrorCode: () => null }));
vi.mock("@/convex/assignmentDetails", () => ({
  loadConvexAssignmentWorkbench: mocks.workbench,
  loadConvexAssignmentAudioPage: mocks.audio,
  createConvexAssignmentReview: mocks.review,
  createConvexAssignmentGuess: mocks.guess,
}));
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: () => <input type="checkbox" />,
}));
vi.mock("@/components/Review/RatingIcon", () => ({ default: () => <span /> }));
import { ConvexAssignmentDetailPage } from "./ConvexAssignmentDetailPage";
const firstUser = { id: "user-1", name: "Alice", status: "active" };
const lastUser = { id: "user-51", name: "Zara", status: "active" };
const firstSeason = { id: "season-1", title: "Season 1" };
const lastSeason = { id: "season-31", title: "Season 31" };
let renderer: ReactTestRenderer;
function button(label: string) {
  return renderer.root
    .findAllByType("button")
    .find((node) => node.children.includes(label));
}
function requiredButton(label: string) {
  const found = button(label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}
function select(id: string, value: string) {
  act(() =>
    renderer.root.findByProps({ id }).props.onChange({ target: { value } })
  );
}
async function render() {
  await act(async () => {
    renderer = create(<ConvexAssignmentDetailPage />);
  });
}
function options(id: string) {
  return renderer.root
    .findByProps({ id })
    .findAllByType("option")
    .map((node) => node.props.value);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.users.mockImplementation(async (_client, cursor) =>
    cursor === null
      ? { users: [firstUser], isDone: false, continueCursor: "users-page-2" }
      : { users: [firstUser, lastUser], isDone: true, continueCursor: "" }
  );
  mocks.seasons.mockImplementation(async (_client, cursor) =>
    cursor === null
      ? {
          seasons: [firstSeason],
          isDone: false,
          continueCursor: "seasons-page-2",
        }
      : { seasons: [firstSeason, lastSeason], isDone: true, continueCursor: "" }
  );
  mocks.ratings.mockResolvedValue([{ id: "rating-1", name: "Good", value: 3 }]);
  mocks.audio.mockResolvedValue({
    messages: [],
    isDone: true,
    continueCursor: "",
  });
  mocks.workbench.mockResolvedValue({
    assignment: {
      id: "assignment-1",
      type: "HOMEWORK",
      playable: true,
      slug: "assignment-one",
      user: firstUser,
      movie: { id: "movie-1", title: "Arrival", year: 2016, poster: null },
      episode: {
        id: "episode-1",
        number: 1,
        title: "Episode 1",
        slug: "episode-one",
        status: "published",
      },
    },
    reviews: [
      {
        id: "review-1",
        reviewId: "review-record",
        reviewer: firstUser,
        rating: null,
        reviewedAt: null,
        guesses: [],
      },
    ],
    wagers: [],
  });
  mocks.review.mockResolvedValue(undefined);
  mocks.guess.mockResolvedValue(undefined);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

test("loads later users and seasons with cursors and submits those choices", async () => {
  await render();
  select("review-user", firstUser.id);
  await act(async () => {
    requiredButton("Load more users").props.onClick();
  });
  await act(async () => {
    requiredButton("Load more seasons").props.onClick();
  });
  expect(mocks.users).toHaveBeenLastCalledWith(mocks.client, "users-page-2");
  expect(mocks.seasons).toHaveBeenLastCalledWith(
    mocks.client,
    "seasons-page-2"
  );
  expect(options("review-user")).toEqual(["", firstUser.id, lastUser.id]);
  expect(options("guess-user")).toContain(lastUser.id);
  expect(options("guess-season")).toContain(lastSeason.id);
  expect(renderer.root.findByProps({ id: "review-user" }).props.value).toBe(
    firstUser.id
  );
  expect(button("Load more users")).toBeUndefined();
  expect(button("Load more seasons")).toBeUndefined();
  select("guess-user", lastUser.id);
  select("guess-rating", "rating-1");
  select("guess-season", lastSeason.id);
  await act(async () => {
    requiredButton("Add guess").props.onClick();
  });
  expect(mocks.guess).toHaveBeenCalledWith(
    mocks.client,
    expect.objectContaining({ userId: lastUser.id, seasonId: lastSeason.id })
  );
  await act(async () => {
    requiredButton("Load more users").props.onClick();
  });
  select("review-user", lastUser.id);
  await act(async () => {
    requiredButton("Add review").props.onClick();
  });
  expect(mocks.review).toHaveBeenCalledWith(
    mocks.client,
    expect.objectContaining({ userId: lastUser.id })
  );
});

test("failed pagination keeps loaded choices and retries the same cursor", async () => {
  await render();
  mocks.users.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    requiredButton("Load more users").props.onClick();
  });
  expect(mocks.error).toHaveBeenCalledWith(
    "More users could not be loaded. Try again."
  );
  expect(options("review-user")).toContain(firstUser.id);
  expect(requiredButton("Load more users").props.disabled).toBe(false);
  await act(async () => {
    requiredButton("Load more users").props.onClick();
  });
  expect(mocks.users.mock.calls.slice(1).map((args) => args[1])).toEqual([
    "users-page-2",
    "users-page-2",
  ]);
  expect(options("review-user")).toContain(lastUser.id);
});
