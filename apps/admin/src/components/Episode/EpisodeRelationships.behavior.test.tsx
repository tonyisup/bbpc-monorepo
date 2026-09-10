import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";

const mocks = vi.hoisted(() => ({
  client: { mutation: vi.fn() },
  users: vi.fn(),
  search: vi.fn(),
  upsert: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
vi.mock("@/convex/catalog", () => ({
  searchConvexTmdbMovies: mocks.search,
  upsertConvexAdminMovie: mocks.upsert,
  searchConvexCatalogMovies: vi.fn(),
  searchConvexCatalogShows: vi.fn(),
}));
vi.mock("@/convex/users", () => ({ loadConvexAdminUsersPage: mocks.users }));
vi.mock("@/components/ui/dialog", () => {
  const Element = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: Element,
    DialogContent: Element,
    DialogDescription: Element,
    DialogFooter: Element,
    DialogHeader: Element,
    DialogTitle: Element,
  };
});
vi.mock("@/components/ui/select", () => {
  const Element = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Select: Element,
    SelectContent: Element,
    SelectItem: Element,
    SelectTrigger: Element,
    SelectValue: Element,
  };
});
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: () => <input type="checkbox" />,
}));
import { EpisodeRelationships } from "./EpisodeRelationships";

const episode = {
  id: "episode-1",
  assignments: [],
  extras: [],
} as unknown as ConvexAdminEpisodeDetail;
const movie = {
  id: 329865,
  title: "Arrival",
  release_date: "2016-11-11",
  first_air_date: null,
  poster_path: null,
};
let renderer: ReactTestRenderer;
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
    .find((node) => nodeText(node).includes(text));
  if (!found) throw new Error(`Button missing: ${text}`);
  return found;
}
function submitButton() {
  const found = renderer.root
    .findAllByType("button")
    .find(
      (node) =>
        node.props.type === "button" && node.children.includes("Add assignment")
    );
  if (!found) throw new Error("Submit button missing");
  return found;
}
async function selectAssignment() {
  await act(async () => {
    renderer = create(
      <EpisodeRelationships episode={episode} onRefresh={mocks.refresh} />
    );
  });
  await act(async () => {
    button("Add assignment").props.onClick();
  });
  expect(submitButton().props.disabled).toBe(true);
  act(() => {
    button("Alice").props.onClick();
  });
  act(() => {
    renderer.root
      .findByProps({ placeholder: "Search TMDB movies" })
      .props.onChange({ target: { value: "Arrival" } });
  });
  await act(async () => {
    button("Search").props.onClick();
  });
  act(() => {
    button("Arrival").props.onClick();
  });
  expect(submitButton().props.disabled).toBe(false);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.users.mockResolvedValue({
    users: [{ id: "user-1", name: "Alice", email: null, status: "active" }],
    isDone: true,
    continueCursor: "",
  });
  mocks.search.mockResolvedValue([movie]);
  mocks.client.mutation.mockResolvedValue({ id: "assignment-1" });
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

test("submitting the selected movie awaits its save before creating one assignment", async () => {
  const savedMovie = deferred<{ id: string }>();
  const assignment = deferred<{ id: string }>();
  mocks.upsert.mockReturnValue(savedMovie.promise);
  mocks.client.mutation.mockReturnValue(assignment.promise);
  await selectAssignment();
  const submit = submitButton().props.onClick;
  act(() => {
    submit();
    submit();
  });
  expect(mocks.upsert).toHaveBeenCalledTimes(1);
  expect(mocks.upsert).toHaveBeenCalledWith(mocks.client, movie);
  expect(mocks.client.mutation).not.toHaveBeenCalled();
  expect(submitButton().props.disabled).toBe(true);
  await act(async () => {
    savedMovie.resolve({ id: "saved-movie" });
  });
  expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
  const call = mocks.client.mutation.mock.calls[0];
  if (!call) throw new Error("Assignment mutation missing");
  expect(getFunctionName(call[0])).toBe("assignments/admin:create");
  expect(call[1]).toMatchObject({
    episodeId: "episode-1",
    userId: "user-1",
    movieId: "saved-movie",
    type: "HOMEWORK",
    playable: true,
  });
  expect(mocks.refresh).not.toHaveBeenCalled();
  await act(async () => {
    assignment.resolve({ id: "assignment-1" });
  });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findAllByProps({ placeholder: "Search TMDB movies" })
  ).toHaveLength(0);
});

test("a failed movie save never creates an assignment and retains the selection for retry", async () => {
  mocks.upsert
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ id: "saved-movie" });
  await selectAssignment();
  await act(async () => {
    submitButton().props.onClick();
  });
  expect(mocks.client.mutation).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(submitButton().props.disabled).toBe(false);
  await act(async () => {
    submitButton().props.onClick();
  });
  expect(mocks.upsert).toHaveBeenCalledTimes(2);
  expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

test("a failed assignment save keeps the dialog open without reporting success", async () => {
  mocks.upsert.mockResolvedValue({ id: "saved-movie" });
  mocks.client.mutation.mockRejectedValueOnce(new Error("offline"));
  await selectAssignment();
  await act(async () => {
    submitButton().props.onClick();
  });
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(submitButton().props.disabled).toBe(false);
});
