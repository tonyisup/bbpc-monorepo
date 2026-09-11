import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/Episode", () => ({
  Episode: ({ episode }: { episode: { id: string; title: string } }) => (
    <article data-episode={episode.id}>{episode.title}</article>
  ),
}));
import { HistoryPageClient } from "@/app/history/HistoryPageClient";
import { formatTranscriptTime } from "@/app/history/TranscriptMatches";
const episode = {
  id: "one",
  number: 1,
  title: "Underwater cinema",
  recording: null,
  date: null,
  description: null,
  status: "published",
  slug: "underwater",
  assignments: [],
  extras: [],
  links: [],
};
const match = {
  episode,
  passages: [{ start: 65, end: 80, text: "A luminous jellyfish appears." }],
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.params = new URLSearchParams();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => {
    renderer = create(<HistoryPageClient allEpisodes={[episode]} />);
  });
}
async function search(query: string) {
  await act(async () => {
    renderer.root
      .findByProps({ "aria-label": "Search episodes" })
      .props.onChange({ target: { value: query } });
  });
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}
const response = (results = [match], limited = false) => ({
  ok: true,
  json: async () => ({ results, limited }),
});
test("finds transcript-only episodes with highlighted passage and timestamp", async () => {
  mocks.fetch.mockResolvedValue(response());
  await render();
  expect(mocks.fetch).not.toHaveBeenCalled();
  await search("jellyfish");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  expect(renderer.root.findByType("mark").children).toEqual(["jellyfish"]);
  expect(JSON.stringify(renderer.toJSON())).toContain("1:05");
  expect(JSON.stringify(renderer.toJSON())).toContain(
    "Automatically generated"
  );
});
test("deduplicates metadata matches and keeps them when transcript search fails", async () => {
  mocks.fetch.mockResolvedValue(response());
  await render();
  await search("Underwater");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  mocks.fetch.mockRejectedValue(new Error("offline"));
  await search("cinema");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  expect(renderer.root.findByProps({ role: "alert" })).toBeDefined();
  mocks.fetch.mockResolvedValue(response([], true));
  await act(async () => {
    renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("Retry transcript search"))!
      .props.onClick();
  });
  await tick();
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("Narrow your search");
});
test("clearing/changing search hides stale passages and ignores late responses", async () => {
  let resolveFirst!: (value: unknown) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFirst = resolve;
    })
  );
  mocks.fetch.mockResolvedValue(response([]));
  await render();
  await search("jellyfish");
  await tick();
  await search("turtle");
  await tick();
  await act(async () => {
    resolveFirst(response());
  });
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  mocks.fetch.mockResolvedValue(response());
  await search("jellyfish");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  await search("");
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
});
test("loads q from URL and avoids requests for invalid queries", async () => {
  mocks.params = new URLSearchParams("q=jellyfish");
  mocks.fetch.mockResolvedValue(response());
  await render();
  await tick();
  expect(mocks.fetch.mock.calls[0]![0]).toContain("q=jellyfish");
  await search("word ".repeat(17));
  await tick();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(renderer.toJSON())).toContain("up to 16 words");
  expect(formatTranscriptTime(3665)).toBe("1:01:05");
});
test("returning to a prior query waits for a new response after change or clear", async () => {
  mocks.fetch.mockResolvedValueOnce(response());
  mocks.fetch.mockReturnValue(new Promise(() => {}));
  await render();
  await search("jellyfish");
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  await search("turtle");
  await tick();
  await search("jellyfish");
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain("Searching transcripts");
  mocks.fetch.mockResolvedValueOnce(response());
  await tick();
  expect(renderer.root.findAllByType("article")).toHaveLength(1);
  await search("");
  await search("jellyfish");
  expect(renderer.root.findAllByType("article")).toHaveLength(0);
});
