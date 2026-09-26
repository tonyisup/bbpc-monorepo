import { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { YouTubeAPI } from "@/lib/youtubePlayer";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/youtubePlayer", () => ({ loadYouTubeAPI: mocks.load }));
import { QuoteClipEditor } from "@/components/QuoteClipEditor";

const media = {
  destroy: vi.fn(),
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  seekTo: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  getDuration: vi.fn(() => 100),
  getPlayerState: vi.fn(() => 2),
};
let events: ConstructorParameters<YouTubeAPI["Player"]>[1]["events"];
let view: ReactTestRenderer;

function Harness() {
  const [range, setRange] = useState({ start: 2, end: 4 });
  const [quote, setQuote] = useState("Original quote");
  return (
    <>
      <QuoteClipEditor
        videoId="abcdefghijk"
        initialStart={0}
        {...range}
        onRangeChange={(start, end) => setRange({ start, end })}
        onQuoteChange={setQuote}
      />
      <output>{quote}</output>
    </>
  );
}

async function render() {
  await act(async () => {
    view = create(<Harness />, {
      createNodeMock: (element) =>
        element.type === "div"
          ? { appendChild: vi.fn(), replaceChildren: vi.fn() }
          : null,
    });
    await Promise.resolve();
  });
  act(() => events.onReady());
}

function button(label: string) {
  return view.root
    .findAllByType("button")
    .find((node) => node.children.join("") === label)!;
}

describe("quote player interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    media.getCurrentTime.mockReturnValue(0);
    media.getDuration.mockReturnValue(100);
    media.getPlayerState.mockReturnValue(2);
    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("document", { createElement: () => ({}) });
    mocks.load.mockResolvedValue({
      Player: class {
        constructor(
          _element: unknown,
          options: ConstructorParameters<YouTubeAPI["Player"]>[1]
        ) {
          events = options.events;
          return media;
        }
      },
    });
  });
  afterEach(() => {
    act(() => view?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("previews only the selection, pauses at the end and destroys the player", async () => {
    await render();
    act(() => button("▶ Preview quote").props.onClick());
    expect(media.seekTo).toHaveBeenLastCalledWith(2, true);
    expect(media.playVideo).toHaveBeenCalledOnce();
    media.getCurrentTime.mockReturnValue(4.05);
    media.getPlayerState.mockReturnValue(1);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.pauseVideo).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.pauseVideo).toHaveBeenCalledOnce();
    act(() => view.unmount());
    expect(media.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("repeats the selected range and stops previewing on a manual seek", async () => {
    await render();
    act(() =>
      view.root
        .findByProps({ type: "checkbox" })
        .props.onChange({ target: { checked: true } })
    );
    act(() => button("▶ Preview quote").props.onClick());
    media.getCurrentTime.mockReturnValue(4);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.seekTo).toHaveBeenLastCalledWith(2, true);
    expect(media.playVideo).toHaveBeenCalledTimes(2);
    act(() =>
      view.root
        .findByProps({ "aria-label": "Seek video" })
        .props.onChange({ target: { value: "20" } })
    );
    media.getCurrentTime.mockReturnValue(20);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.seekTo).toHaveBeenLastCalledWith(20, true);
    expect(media.playVideo).toHaveBeenCalledTimes(2);
  });

  test("selects timed words with the keyboard, requires explicit text use and rejects invalid subtitles", async () => {
    await render();
    act(() =>
      view.root
        .findByProps({ "aria-label": "Timed subtitles" })
        .props.onChange({
          target: {
            value:
              "WEBVTT\n\n00:00:12.000 --> 00:00:15.000\nYou <00:00:13.000>can <00:00:14.000>do this.",
          },
        })
    );
    act(() => button("Load transcript").props.onClick());
    act(() =>
      view.root
        .findByProps({ "aria-label": "You, 0:12.0" })
        .props.onClick({ detail: 0, shiftKey: false })
    );
    act(() =>
      view.root
        .findByProps({ "aria-label": "do this., 0:14.0" })
        .props.onClick({ detail: 0, shiftKey: true })
    );
    expect(
      view.root.findByProps({ "aria-label": "Quote start" }).props[
        "aria-valuenow"
      ]
    ).toBe(12);
    expect(
      view.root.findByProps({ "aria-label": "Quote end" }).props[
        "aria-valuenow"
      ]
    ).toBe(15);
    expect(view.root.findByType("output").children).toEqual(["Original quote"]);
    act(() => button("Use selected text as quote").props.onClick());
    expect(view.root.findByType("output").children).toEqual([
      "You can do this.",
    ]);
    act(() =>
      view.root.findByProps({ "aria-label": "Quote end" }).props.onKeyDown({
        key: "ArrowRight",
        shiftKey: false,
        preventDefault: vi.fn(),
      })
    );
    expect(button("Use selected text as quote").props.disabled).toBe(true);
    act(() =>
      view.root
        .findByProps({ "aria-label": "Timed subtitles" })
        .props.onChange({ target: { value: "no timestamps" } })
    );
    act(() => button("Load transcript").props.onClick());
    expect(
      view.root.findByProps({ role: "alert" }).children.join("")
    ).toContain("No timed subtitles");
  });

  test("keeps manual selection usable when embedding is blocked", async () => {
    await render();
    act(() => events.onError({ data: 150 }));
    expect(button("▶ Preview quote").props.disabled).toBe(true);
    expect(
      view.root.findByProps({ role: "alert" }).children.join("")
    ).toContain("cannot play here");
    expect(
      view.root.findByProps({ "aria-label": "Quote start" })
    ).toBeDefined();
  });
});
