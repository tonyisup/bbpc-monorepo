import { useState, type ReactElement } from "react";
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

const durationChange = vi.fn();

function RangeHarness({
  initialStart,
  start = null,
  end = null,
  seedDefaultRange = true,
}: {
  initialStart: number;
  start?: number | null;
  end?: number | null;
  seedDefaultRange?: boolean;
}) {
  const [range, setRange] = useState({ start, end });
  return (
    <QuoteClipEditor
      videoId="abcdefghijk"
      initialStart={initialStart}
      {...range}
      onRangeChange={(nextStart, nextEnd) =>
        setRange({ start: nextStart, end: nextEnd })
      }
      onQuoteChange={vi.fn()}
      onDurationChange={durationChange}
      seedDefaultRange={seedDefaultRange}
    />
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function mount(element: ReactElement) {
  await act(async () => {
    view = create(element, {
      createNodeMock: (node) =>
        node.type === "div"
          ? { appendChild: vi.fn(), replaceChildren: vi.fn() }
          : null,
    });
  });
  await flush();
}

const handle = (edge: "start" | "end") =>
  view.root.findByProps({ "aria-label": `Quote ${edge}` });
const text = () => JSON.stringify(view.toJSON());
const alertText = () =>
  view.root
    .findAllByProps({ role: "alert" })
    .filter((node) => typeof node.type === "string")
    .map((node) => node.children.join(""))
    .join(" ");

function button(label: string) {
  return view.root.findAllByType("button").find(
    (node) =>
      node.children
        .filter((child) => typeof child === "string")
        .join("")
        .trim() === label
  )!;
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
    act(() => button("Preview quote").props.onClick());
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
    act(() => button("Preview quote").props.onClick());
    media.getCurrentTime.mockReturnValue(4);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.seekTo).toHaveBeenLastCalledWith(2, true);
    expect(media.playVideo).toHaveBeenCalledTimes(2);
    const slider = () => view.root.findByProps({ "aria-label": "Seek video" });
    // Scrubbing doesn't request new buffers; releasing the slider does.
    act(() => slider().props.onChange({ target: { value: "20" } }));
    expect(media.seekTo).toHaveBeenLastCalledWith(20, false);
    act(() => slider().props.onPointerUp({ currentTarget: { value: "20" } }));
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

  test("explains load failures, slow or unavailable videos and blocked autoplay, and retries on request", async () => {
    mocks.load.mockRejectedValueOnce(
      new Error("YouTube could not load. Check your connection or try again.")
    );
    await mount(<RangeHarness initialStart={0} start={2} end={4} />);
    expect(alertText()).toContain("YouTube could not load");
    expect(alertText()).toContain("You can still enter times manually.");
    expect(handle("start").props["aria-valuenow"]).toBe(2);

    act(() => button("Retry player").props.onClick());
    await flush();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(alertText()).toBe("");
    expect(text()).toContain("Loading YouTube player");
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(alertText()).toContain("taking too long");
    act(() => events.onError({ data: 100 }));
    expect(alertText()).toContain("private or unavailable");
    act(() => events.onError({ data: 5 }));
    expect(alertText()).toContain("could not play this video");
    act(() => events.onAutoplayBlocked());
    expect(text()).toContain("Press play in the YouTube player");
  });

  test("starts a ten-second range at the link time, caps long videos at 24 hours, and trims without crossing edges", async () => {
    media.getDuration.mockReturnValue(90_000);
    await mount(<RangeHarness initialStart={30} />);
    act(() => events.onReady());
    expect(durationChange).toHaveBeenCalledWith(86_400);
    expect(handle("start").props["aria-valuenow"]).toBe(30);
    expect(handle("end").props["aria-valuenow"]).toBe(40);
    expect(handle("end").props["aria-valuemax"]).toBe(86_400);

    media.getCurrentTime.mockReturnValue(45.1234);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => button("Set start here").props.onClick());
    expect(handle("start").props["aria-valuenow"]).toBe(45.123);
    expect(handle("end").props["aria-valuenow"]).toBeCloseTo(55.123);
    media.getCurrentTime.mockReturnValue(50);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => button("Set end here").props.onClick());
    expect(handle("end").props["aria-valuenow"]).toBe(50);
    media.getCurrentTime.mockReturnValue(44);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(button("Set end here").props.disabled).toBe(true);

    for (let i = 0; i < 6; i += 1)
      act(() =>
        handle("start").props.onKeyDown({
          key: "ArrowRight",
          shiftKey: true,
          preventDefault: vi.fn(),
        })
      );
    expect(handle("start").props["aria-valuenow"]).toBe(49.999);
    act(() =>
      handle("end").props.onKeyDown({
        key: "ArrowLeft",
        shiftKey: true,
        preventDefault: vi.fn(),
      })
    );
    const [start, end] = [handle("start"), handle("end")].map(
      (node) => node.props["aria-valuenow"] as number
    );
    expect(end).toBeGreaterThan(start!);
    expect(end).toBeCloseTo(50, 3);
  });

  test("flags a range past the video and refuses subtitles beyond it or oversized, unreadable and superseded files", async () => {
    await mount(<RangeHarness initialStart={0} start={2} end={150} />);
    act(() => events.onReady());
    expect(alertText()).toContain(
      "The end must be after the start and within this video."
    );
    expect(text()).toContain("Set a start and a later end time below.");
    expect(button("Preview quote").props.disabled).toBe(true);

    const subtitles = () =>
      view.root.findByProps({ "aria-label": "Timed subtitles" });
    act(() =>
      subtitles().props.onChange({
        target: { value: "00:02:00.000 --> 00:02:05.000\nToo late" },
      })
    );
    act(() => button("Load transcript").props.onClick());
    expect(alertText()).toContain("extend beyond the video");

    const file = () => view.root.findByProps({ type: "file" });
    const choose = (text: () => Promise<string>, size = 10) =>
      file().props.onChange({ target: { files: [{ size, text }] } });
    act(() => choose(vi.fn(), 500_001));
    expect(alertText()).toContain("smaller than 500 KB");
    act(() => choose(() => Promise.reject(new Error("denied"))));
    await flush();
    expect(alertText()).toContain("Could not read that file");

    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFrom file";
    let finish: (value: string) => void = vi.fn();
    act(() =>
      choose(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          })
      )
    );
    act(() => subtitles().props.onChange({ target: { value: "typed" } }));
    await act(async () => finish(vtt));
    expect(subtitles().props.value).toBe("typed");
    expect(text()).not.toContain("Subtitles loaded");

    act(() => choose(() => Promise.resolve(vtt)));
    await flush();
    expect(subtitles().props.value).toBe(vtt);
    expect(text()).toContain("Subtitles loaded · 1 timed blocks");
    expect(alertText()).not.toContain("file");
  });

  test("keeps manual selection usable when embedding is blocked", async () => {
    await render();
    act(() => events.onError({ data: 150 }));
    expect(button("Preview quote").props.disabled).toBe(true);
    expect(
      view.root.findByProps({ role: "alert" }).children.join("")
    ).toContain("cannot play here");
    expect(
      view.root.findByProps({ "aria-label": "Quote start" })
    ).toBeDefined();
  });

  test("never invents an end for a saved clip that only has a start", async () => {
    await mount(
      <RangeHarness initialStart={0} start={42} seedDefaultRange={false} />
    );
    act(() => events.onReady());
    expect(durationChange).toHaveBeenCalledWith(100);
    expect(
      view.root.findAllByProps({ "aria-label": "Quote end" })
    ).toHaveLength(0);
    expect(text()).toContain("Set a start and a later end time below.");
  });

  test("reports a video length that changes after loading", async () => {
    await mount(<RangeHarness initialStart={0} />);
    act(() => events.onReady());
    expect(durationChange).toHaveBeenLastCalledWith(100);
    media.getDuration.mockReturnValue(130);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(durationChange).toHaveBeenLastCalledWith(130);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(durationChange).toHaveBeenCalledTimes(2);
  });

  test("a cue accepted at import stays selectable, and a refused selection's error clears", async () => {
    await mount(<RangeHarness initialStart={95} />);
    act(() => events.onReady());
    act(() =>
      view.root
        .findByProps({ "aria-label": "Timed subtitles" })
        .props.onChange({
          target: {
            value:
              "WEBVTT\n\n00:01:38.000 --> 00:01:39.000\nEarlier.\n\n00:01:39.000 --> 00:01:40.050\nLast line.",
          },
        })
    );
    act(() => button("Load transcript").props.onClick());
    act(() =>
      view.root
        .findByProps({ "aria-label": "Last line., 1:39.0" })
        .props.onClick({ detail: 0, shiftKey: false })
    );
    expect(alertText()).not.toContain("extend beyond");
    expect(handle("end").props["aria-valuenow"]).toBe(100);
  });
});
