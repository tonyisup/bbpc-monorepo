import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { YouTubeVideoSearch } from "@/components/YouTubeVideoSearch";

vi.mock("next/image", () => ({ default: () => <span /> }));
const fetchMock = vi.fn();
const select = vi.fn();
let view: ReactTestRenderer;
const video = {
  id: "abcdefghijk",
  title: "Movie scene",
  channel: "Movie channel",
};
const response = (videos = [video], nextPageToken: string | null = null) =>
  new Response(JSON.stringify({ videos, nextPageToken }));

beforeEach(() => {
  fetchMock.mockReset();
  select.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  act(() => {
    view = create(
      <YouTubeVideoSearch onSelect={select} suggestedQuery="Movie quote" />
    );
  });
});
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
});
function button(text: string) {
  const match = view.root
    .findAllByType("button")
    .find((item) => item.children.join("") === text);
  if (!match) throw new Error(`Button not found: ${text}`);
  return match;
}
function input() {
  return view.root.findByType("input");
}

test("searches only on demand and selects a result without submitting the surrounding form", async () => {
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(response());
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  await act(async () => {
    input().props.onKeyDown({ key: "Enter", preventDefault, stopPropagation });
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(stopPropagation).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/youtube/search?q=Movie+quote",
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
  const useVideo = view.root.findByProps({
    "aria-label": "Use video: Movie scene",
  });
  expect(useVideo.props.type).toBe("button");
  act(() => useVideo.props.onClick());
  expect(select).toHaveBeenCalledWith(
    "https://www.youtube.com/watch?v=abcdefghijk"
  );
  expect(button("Show search results")).toBeDefined();
  act(() => button("Show search results").props.onClick());
  expect(
    view.root.findByProps({ "aria-label": "Use video: Movie scene" })
  ).toBeDefined();
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("aborts stale queries and suppresses late responses", async () => {
  let finish: (value: Response) => void = vi.fn();
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    button("Search").props.onClick();
  });
  const signal = fetchMock.mock.calls[0]?.[1].signal;
  act(() => input().props.onChange({ target: { value: "different movie" } }));
  expect(signal.aborted).toBe(true);
  // Returning to the original words must not revive the abandoned request.
  act(() => input().props.onChange({ target: { value: "Movie quote" } }));
  await act(async () => finish(response()));
  expect(JSON.stringify(view.toJSON())).not.toContain("Movie scene");
});

test("appends pagination without duplicates and retains results on failure", async () => {
  fetchMock.mockResolvedValueOnce(response([video], "page2"));
  await act(async () => {
    button("Search").props.onClick();
  });
  fetchMock.mockResolvedValueOnce(
    response(
      [video, { ...video, id: "lmnopqrstuv", title: "Another scene" }],
      "page3"
    )
  );
  await act(async () => {
    button("More results").props.onClick();
  });
  expect(fetchMock.mock.calls[1]?.[0]).toContain("pageToken=page2");
  expect(view.root.findAllByType("li")).toHaveLength(2);
  fetchMock.mockResolvedValueOnce(new Response("quota", { status: 503 }));
  await act(async () => {
    button("More results").props.onClick();
  });
  expect(view.root.findByProps({ role: "alert" }).children.join("")).toContain(
    "unavailable"
  );
  expect(view.root.findAllByType("li")).toHaveLength(2);
});

test("explains sign-in, network and malformed-response failures without showing stale matches", async () => {
  const alert = () =>
    view.root.findByProps({ role: "alert" }).children.join("");
  fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(alert()).toBe("Sign in to search for videos.");
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(alert()).toContain("unavailable");
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ videos: [{ id: "bad" }] }))
  );
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(alert()).toContain("unavailable");
  expect(view.root.findAllByType("li")).toHaveLength(0);
  expect(JSON.stringify(view.toJSON())).not.toContain("No videos found");
});

test("ignores too-short searches and repeat presses while a search is running", async () => {
  act(() => input().props.onChange({ target: { value: "  a  " } }));
  expect(button("Search").props.disabled).toBe(true);
  await act(async () => {
    input().props.onKeyDown({
      key: "Enter",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
  });
  expect(fetchMock).not.toHaveBeenCalled();

  act(() => input().props.onChange({ target: { value: "  Heat   diner " } }));
  let finish: (value: Response) => void = vi.fn();
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(button("Search").props.disabled).toBe(true);
  expect(JSON.stringify(view.toJSON())).toContain("Searching YouTube");
  await act(async () => {
    input().props.onKeyDown({
      key: "Enter",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/youtube/search?q=Heat+diner");
  await act(async () => finish(response()));
  expect(view.root.findAllByType("li")).toHaveLength(1);
});

test("stops paging at 24 results and marks the selected video", async () => {
  const page = (offset: number) =>
    Array.from({ length: 6 }, (_, index) => ({
      ...video,
      id: `video${String(offset + index).padStart(6, "0")}`,
      title: `Scene ${offset + index}`,
    }));
  fetchMock.mockResolvedValueOnce(response(page(0), "p2"));
  await act(async () => {
    button("Search").props.onClick();
  });
  for (const offset of [6, 12, 18]) {
    fetchMock.mockResolvedValueOnce(response(page(offset), "more"));
    await act(async () => {
      button("More results").props.onClick();
    });
  }
  expect(view.root.findAllByType("li")).toHaveLength(24);
  expect(
    view.root
      .findAllByType("button")
      .some((item) => item.children.join("") === "More results")
  ).toBe(false);
  expect(JSON.stringify(view.toJSON())).toContain("Try a more specific search");

  act(() => {
    view.update(
      <YouTubeVideoSearch
        onSelect={select}
        suggestedQuery="Movie quote"
        selectedVideoId="video000003"
      />
    );
  });
  const chosen = view.root.findByProps({ "aria-label": "Use video: Scene 3" });
  expect(chosen.props["aria-pressed"]).toBe(true);
  expect(chosen.props.children).toBe("Selected");
  act(() => chosen.props.onClick());
  expect(JSON.stringify(view.toJSON())).toContain(
    "Loaded into the quote player: Scene 3"
  );
});

test("distinguishes unavailable search from no matches", async () => {
  fetchMock.mockResolvedValueOnce(new Response("missing key", { status: 503 }));
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(JSON.stringify(view.toJSON())).toContain("unavailable");
  expect(JSON.stringify(view.toJSON())).not.toContain("No videos found");
  fetchMock.mockResolvedValueOnce(response([]));
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(JSON.stringify(view.toJSON())).toContain("No videos found");
});

test("shows the route's own reason when search is switched off", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error:
          "Video search is unavailable right now. You can still paste a clip link below.",
      }),
      { status: 503 }
    )
  );
  await act(async () => {
    button("Search").props.onClick();
  });
  expect(JSON.stringify(view.toJSON())).toContain(
    "You can still paste a clip link below."
  );
  expect(JSON.stringify(view.toJSON())).not.toContain("Try again");
});
