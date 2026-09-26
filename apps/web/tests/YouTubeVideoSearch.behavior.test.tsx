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
