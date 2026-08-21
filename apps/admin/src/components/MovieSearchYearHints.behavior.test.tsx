import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: {},
  loadMovies: vi.fn(),
  loadShows: vi.fn(),
  searchMovies: vi.fn(),
  searchShows: vi.fn(),
  searchAssignmentMovies: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
}));

vi.mock("next/head", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/image", () => ({
  default: () => <span data-next-image />,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
  },
}));

vi.mock("@/convex/catalog", () => ({
  deleteConvexAdminMovie: vi.fn(),
  deleteConvexAdminShow: vi.fn(),
  loadConvexAdminMoviesPage: mocks.loadMovies,
  loadConvexAdminShowsPage: mocks.loadShows,
  searchConvexCatalogMovies: vi.fn(),
  searchConvexCatalogShows: vi.fn(),
  searchConvexTmdbMovies: mocks.searchMovies,
  searchConvexTmdbShows: mocks.searchShows,
  upsertConvexAdminMovie: vi.fn(),
  upsertConvexAdminShow: vi.fn(),
}));

vi.mock("@/convex/episodeDetails", () => ({
  addConvexAdminEpisodeAssignmentFromTmdb: vi.fn(),
  addConvexAdminEpisodeExtra: vi.fn(),
  removeConvexAdminEpisodeAssignment: vi.fn(),
  searchConvexAdminAssignmentMovies: mocks.searchAssignmentMovies,
}));

vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: () => null,
}));

vi.mock("@/convex/reviews", () => ({
  deleteConvexAdminReview: vi.fn(),
  loadConvexReviewDeleteImpact: vi.fn(),
}));

vi.mock("@/convex/users", () => ({
  loadConvexAdminUsersPage: vi.fn(),
}));

vi.mock("@/components/ui/confirm-modal", () => ({
  ConfirmModal: () => null,
}));

vi.mock("lucide-react", () => {
  const Icon = () => <svg />;
  return {
    ExternalLink: Icon,
    Film: Icon,
    Loader2: Icon,
    Plus: Icon,
    RefreshCw: Icon,
    Search: Icon,
    Trash2: Icon,
    Tv: Icon,
  };
});

import { TmdbMoviePicker } from "./Episode/EpisodeRelationships";
import { ConvexMediaCatalogPage } from "./Media/ConvexMediaCatalogPage";

type InputNode = {
  focus: ReturnType<typeof vi.fn>;
  setSelectionRange: ReturnType<typeof vi.fn>;
  value: string;
};

const inputNodes = new Map<string, InputNode>();
let renderer: ReactTestRenderer | null = null;

function nodeMock(element: { type: unknown; props: Record<string, unknown> }) {
  if (element.type !== "input") {
    return {};
  }
  const key = String(element.props.id ?? element.props["aria-label"] ?? "input");
  const node: InputNode = {
    focus: vi.fn(),
    setSelectionRange: vi.fn(),
    value: String(element.props.value ?? ""),
  };
  inputNodes.set(key, node);
  return node;
}

function renderedText(rendered: ReactTestRenderer) {
  return JSON.stringify(rendered.toJSON());
}

function changeInput(
  rendered: ReactTestRenderer,
  props: Record<string, unknown>,
  value: string,
) {
  act(() => {
    rendered.root.findByProps(props).props.onChange({ target: { value } });
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickSearch(rendered: ReactTestRenderer) {
  const search = rendered.root
    .findAllByType("button")
    .find((button) => button.children.includes("Search"));
  if (!search) {
    throw new Error("Search button was not rendered.");
  }
  act(() => search.props.onClick());
}

async function renderCatalog(kind: "movie" | "show" = "movie") {
  await act(async () => {
    renderer = create(<ConvexMediaCatalogPage kind={kind} />, {
      createNodeMock: nodeMock,
    });
    await Promise.resolve();
  });
  if (!renderer) {
    throw new Error("Catalog page did not render.");
  }
  return renderer;
}

async function renderAssignmentPicker({
  onClearSelection = vi.fn(),
  onSelect = vi.fn(),
}: {
  onClearSelection?: () => void;
  onSelect?: (movie: unknown) => void;
} = {}) {
  await act(async () => {
    renderer = create(
      <TmdbMoviePicker
        onClearSelection={onClearSelection}
        onSelect={onSelect}
        selection={null}
      />,
      { createNodeMock: nodeMock },
    );
    await Promise.resolve();
  });
  if (!renderer) {
    throw new Error("Assignment picker did not render.");
  }
  return renderer;
}

const tmdbMovie = {
  id: 123,
  title: "The Imposter",
  release_date: "2001-01-01",
  first_air_date: null,
  poster_path: "/poster.jpg",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("admin movie year search hints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    inputNodes.clear();
    const emptyPage = { items: [], continueCursor: null, isDone: true };
    mocks.loadMovies.mockResolvedValue(emptyPage);
    mocks.loadShows.mockResolvedValue(emptyPage);
    mocks.searchMovies.mockResolvedValue([]);
    mocks.searchShows.mockResolvedValue([]);
    mocks.searchAssignmentMovies.mockResolvedValue([]);
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("catalog appends an incomplete modifier, focuses it, and pauses search", async () => {
    const rendered = await renderCatalog();
    changeInput(rendered, { "aria-label": "Search TMDB for a movie" }, "Imposter");
    clickSearch(rendered);
    await flushPromises();

    expect(renderedText(rendered)).toContain("No available movie results");
    act(() =>
      rendered.root.findByProps({ "aria-label": "Add y:year" }).props.onClick(),
    );
    expect(
      rendered.root.findByProps({ "aria-label": "Search TMDB for a movie" })
        .props.value,
    ).toBe("Imposter y:");
    expect(
      inputNodes.get("Search TMDB for a movie")?.focus,
    ).toHaveBeenCalledOnce();
    expect(
      inputNodes.get("Search TMDB for a movie")?.setSelectionRange,
    ).toHaveBeenCalledWith(11, 11);
    expect(mocks.searchMovies).toHaveBeenCalledTimes(1);
  });

  test("catalog rewrite reruns with the transformed query and ignores stale responses", async () => {
    const stale = deferred<typeof tmdbMovie[]>();
    mocks.searchMovies
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const rendered = await renderCatalog();
    changeInput(rendered, { "aria-label": "Search TMDB for a movie" }, "Old movie");
    clickSearch(rendered);

    changeInput(
      rendered,
      { "aria-label": "Search TMDB for a movie" },
      "Imposter (2001)",
    );
    clickSearch(rendered);
    await flushPromises();
    act(() =>
      rendered.root
        .findByProps({ "aria-label": "Use 2001 as release year" })
        .props.onClick(),
    );
    await flushPromises();

    expect(mocks.searchMovies).toHaveBeenLastCalledWith(
      mocks.convex,
      "Imposter y:2001",
    );
    await act(async () => {
      stale.resolve([tmdbMovie]);
      await stale.promise;
    });
    expect(renderedText(rendered)).not.toContain("The Imposter");
  });

  test("catalog delays help for results and suppresses it for shows and failures", async () => {
    mocks.searchMovies.mockResolvedValueOnce([tmdbMovie]);
    const rendered = await renderCatalog();
    changeInput(rendered, { "aria-label": "Search TMDB for a movie" }, "Imposter");
    clickSearch(rendered);
    await flushPromises();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(renderedText(rendered)).not.toContain("Looking for a specific release?");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(renderedText(rendered)).toContain("Looking for a specific release?");

    act(() => {
      renderer?.update(<ConvexMediaCatalogPage kind="show" />);
    });
    changeInput(rendered, { "aria-label": "Search TMDB for a show" }, "Show y:");
    clickSearch(rendered);
    await flushPromises();
    expect(mocks.searchShows).toHaveBeenLastCalledWith(mocks.convex, "Show y:");
    expect(renderedText(rendered)).not.toContain("Add y:year");

    mocks.searchShows.mockRejectedValueOnce(new Error("offline"));
    changeInput(rendered, { "aria-label": "Search TMDB for a show" }, "Other show");
    clickSearch(rendered);
    await flushPromises();
    expect(renderedText(rendered)).toContain("TMDB search is unavailable");
    expect(renderedText(rendered)).not.toContain("No available movie results");
  });

  test("assignment picker rewrites and reruns using the explicit transformed query", async () => {
    const onClearSelection = vi.fn();
    const rendered = await renderAssignmentPicker({ onClearSelection });
    changeInput(
      rendered,
      { id: "episode-assignment-movie-search" },
      "Imposter (2001)",
    );
    clickSearch(rendered);
    await flushPromises();

    act(() =>
      rendered.root
        .findByProps({ "aria-label": "Use 2001 as release year" })
        .props.onClick(),
    );
    await flushPromises();
    expect(mocks.searchAssignmentMovies).toHaveBeenLastCalledWith(
      mocks.convex,
      "Imposter y:2001",
    );
    expect(onClearSelection).toHaveBeenCalled();
    expect(
      inputNodes.get("episode-assignment-movie-search")?.setSelectionRange,
    ).toHaveBeenCalledWith(15, 15);
  });

  test("assignment picker clears a selected movie on every input edit", async () => {
    const onClearSelection = vi.fn();
    const onSelect = vi.fn();
    mocks.searchAssignmentMovies.mockResolvedValueOnce([tmdbMovie]);
    const rendered = await renderAssignmentPicker({ onClearSelection, onSelect });
    changeInput(rendered, { id: "episode-assignment-movie-search" }, "Imposter");
    clickSearch(rendered);
    await flushPromises();

    const result = rendered.root
      .findAllByType("button")
      .find((button) => JSON.stringify(button.children).includes("The Imposter"));
    act(() => result?.props.onClick());
    expect(onSelect).toHaveBeenCalledWith(tmdbMovie);

    changeInput(
      rendered,
      { id: "episode-assignment-movie-search" },
      "Different",
    );
    expect(onClearSelection).toHaveBeenCalledTimes(2);
    expect(renderedText(rendered)).not.toContain("The Imposter");
  });
});
