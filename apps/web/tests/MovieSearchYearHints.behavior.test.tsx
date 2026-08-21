import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: {},
  listSyllabus: vi.fn(),
  searchSyllabusCatalog: vi.fn(),
  searchSyllabusTmdb: vi.fn(),
  searchExtraMovies: vi.fn(),
  searchExtraShows: vi.fn(),
  searchExtraTmdb: vi.fn(),
  router: {
    back: vi.fn(),
    push: vi.fn(),
  },
}));

vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("next/image", () => ({
  default: () => <span data-next-image />,
}));

vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({
    accountIssue: null,
    accountStatus: "ready",
    refreshAccount: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    status: "authenticated",
    user: { appUserId: "user-1" },
  }),
}));

vi.mock("@/convex/syllabus", () => ({
  addConvexSyllabusEntry: vi.fn(),
  listConvexSyllabus: mocks.listSyllabus,
  removeConvexSyllabusEntry: vi.fn(),
  reorderConvexSyllabus: vi.fn(),
  searchConvexCatalogMovies: mocks.searchSyllabusCatalog,
  searchConvexTmdbMovies: mocks.searchSyllabusTmdb,
  updateConvexSyllabusNotes: vi.fn(),
  upsertConvexTmdbMovie: vi.fn(),
}));

vi.mock("@/convex/extras", () => ({
  addMyConvexMovieExtra: vi.fn(),
  addMyConvexShowExtra: vi.fn(),
  searchConvexExtraMovies: mocks.searchExtraMovies,
  searchConvexExtraShows: mocks.searchExtraShows,
  searchConvexExtraTmdb: mocks.searchExtraTmdb,
  upsertConvexExtraMovie: vi.fn(),
  upsertConvexExtraShow: vi.fn(),
}));

vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: () => null,
}));

vi.mock("@/components/MovieInlinePreview", () => ({
  default: ({ movie }: { movie: { title: string } }) => <span>{movie.title}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />,
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: { children?: ReactNode }) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, ...props }: { children?: ReactNode }) => (
    <div data-radio-group {...props}>
      {children}
    </div>
  ),
  RadioGroupItem: (props: Record<string, unknown>) => <button {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: Record<string, unknown>) => <textarea {...props} />,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => {
  const Icon = () => <svg />;
  return {
    ArrowDown: Icon,
    ArrowLeft: Icon,
    ArrowUp: Icon,
    ChevronsUp: Icon,
    Edit3: Icon,
    Loader2: Icon,
    Save: Icon,
    Search: Icon,
    X: Icon,
  };
});

import { ConvexAddExtraPageClient } from "@/app/episodes/[slug]/extras/add/ConvexAddExtraPageClient";
import { ConvexSyllabusManager } from "@/app/syllabus/ConvexSyllabusManager";

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
  const id = String(element.props.id ?? "input");
  const node: InputNode = {
    focus: vi.fn(),
    setSelectionRange: vi.fn(),
    value: String(element.props.value ?? ""),
  };
  inputNodes.set(id, node);
  return node;
}

function renderedText(rendered: ReactTestRenderer) {
  return JSON.stringify(rendered.toJSON());
}

function changeInput(rendered: ReactTestRenderer, id: string, value: string) {
  act(() => {
    rendered.root.findByProps({ id }).props.onChange({ target: { value } });
  });
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function renderSyllabus() {
  await act(async () => {
    renderer = create(<ConvexSyllabusManager appUserId="user-1" />, {
      createNodeMock: nodeMock,
    });
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  if (!renderer) {
    throw new Error("Syllabus manager did not render.");
  }
  act(() => {
    renderer?.root
      .findAllByType("button")
      .find((button) => button.children.includes("Add movie"))
      ?.props.onClick();
  });
  return renderer;
}

async function renderAddExtra() {
  await act(async () => {
    renderer = create(
      <ConvexAddExtraPageClient episodeId="episode-1" episodeSlug="episode-1" />,
      { createNodeMock: nodeMock },
    );
    await Promise.resolve();
  });
  if (!renderer) {
    throw new Error("Add-extra page did not render.");
  }
  return renderer;
}

const tmdbMovie = {
  id: 123,
  title: "The Imposter",
  release_date: "2001-01-01",
  poster_path: "https://image.tmdb.org/poster.jpg",
  imdb_path: null,
};

describe("public movie year search hints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    inputNodes.clear();
    mocks.listSyllabus.mockResolvedValue([]);
    mocks.searchSyllabusCatalog.mockResolvedValue([]);
    mocks.searchSyllabusTmdb.mockResolvedValue([]);
    mocks.searchExtraMovies.mockResolvedValue([]);
    mocks.searchExtraShows.mockResolvedValue([]);
    mocks.searchExtraTmdb.mockResolvedValue([]);
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("syllabus offers an immediate action when returned rows are not usable", async () => {
    mocks.searchSyllabusTmdb.mockResolvedValueOnce([
      { ...tmdbMovie, poster_path: null },
    ]);
    const rendered = await renderSyllabus();
    changeInput(rendered, "convex-movie-search", "Imposter");
    await advance(300);

    expect(renderedText(rendered)).toContain(
      "No available movie results for “Imposter.” Try adding the release year.",
    );
    const action = rendered.root.findByProps({ "aria-label": "Add y:year" });
    act(() => action.props.onClick());

    expect(
      rendered.root.findByProps({ id: "convex-movie-search" }).props.value,
    ).toBe("Imposter y:");
    expect(inputNodes.get("convex-movie-search")?.focus).toHaveBeenCalledOnce();
    expect(
      inputNodes.get("convex-movie-search")?.setSelectionRange,
    ).toHaveBeenCalledWith(11, 11);
    await advance(3_000);
    expect(mocks.searchSyllabusTmdb).toHaveBeenCalledTimes(1);
  });

  test("syllabus rewrites a parenthesized year and reruns the search", async () => {
    const rendered = await renderSyllabus();
    changeInput(rendered, "convex-movie-search", "Imposter (2001)");
    await advance(300);

    const action = rendered.root.findByProps({
      "aria-label": "Use 2001 as release year",
    });
    act(() => action.props.onClick());
    await advance(300);

    expect(mocks.searchSyllabusTmdb).toHaveBeenLastCalledWith(
      mocks.convex,
      "Imposter y:2001",
    );
    expect(renderedText(rendered)).not.toContain("Add y:year");
  });

  test("syllabus delays successful-result help and cancels it after an edit", async () => {
    mocks.searchSyllabusTmdb.mockResolvedValue([tmdbMovie]);
    const rendered = await renderSyllabus();
    changeInput(rendered, "convex-movie-search", "Imposter");
    await advance(300);
    await advance(2_999);
    expect(renderedText(rendered)).not.toContain("Looking for a specific release?");

    changeInput(rendered, "convex-movie-search", "Different");
    expect(renderedText(rendered)).not.toContain("The Imposter");
    await advance(1);
    expect(renderedText(rendered)).not.toContain("Looking for a specific release?");
  });

  test("add-extra shows immediate movie help but never shows it for TV", async () => {
    const rendered = await renderAddExtra();
    changeInput(rendered, "extra-search", "Imposter");
    await advance(300);
    expect(renderedText(rendered)).toContain("Add y:year");

    act(() => {
      rendered.root.findByProps({ "data-radio-group": true }).props.onValueChange(
        "show",
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(rendered)).not.toContain("Add y:year");

    changeInput(rendered, "extra-search", "Imposter y:");
    await advance(300);
    expect(mocks.searchExtraTmdb).toHaveBeenLastCalledWith(
      mocks.convex,
      "show",
      "Imposter y:",
    );
  });

  test("add-extra does not mislabel a TMDB failure as zero results", async () => {
    mocks.searchExtraTmdb.mockRejectedValueOnce(new Error("offline"));
    const rendered = await renderAddExtra();
    changeInput(rendered, "extra-search", "Imposter");
    await advance(300);

    expect(renderedText(rendered)).toContain("External title search is unavailable");
    expect(renderedText(rendered)).not.toContain("Add y:year");
    expect(renderedText(rendered)).not.toContain("No available movie results");
  });
});
