import type * as YouTubeModule from "@bbpc/youtube";
import type { YouTubeAPI } from "@bbpc/youtube";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@bbpc/youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof YouTubeModule>()),
  loadYouTubeAPI: mocks.load,
}));

import {
  clipTimesUpdate,
  EntryChangedError,
  QuoteClipMarker,
} from "./QuoteClipMarker";

const media = {
  destroy: vi.fn(),
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  seekTo: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  getDuration: vi.fn(() => 120),
  getPlayerState: vi.fn(() => 2),
  setPlaybackRate: vi.fn(),
};
let playerOptions: ConstructorParameters<YouTubeAPI["Player"]>[1];
let events: ConstructorParameters<YouTubeAPI["Player"]>[1]["events"];
let keyListeners: Array<(event: KeyboardEvent) => void>;
let view: ReactTestRenderer;

function submission(
  id: string,
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id,
    quoteText: `Line ${id}`,
    sourceTitle: "Heat",
    sourceType: "MOVIE",
    clipUrl: "https://youtu.be/abcdefghijk?t=40",
    clipStartSeconds: 40,
    clipEndSeconds: null,
    listenerNotes: "From the diner scene",
    status: "SUBMITTED",
    bracketOrder: null,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
    userId: `user-${id}`,
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: "Check the audio",
    user: {
      id: `user-${id}`,
      name: `Listener ${id}`,
      email: null,
      image: null,
    },
    episode: { id: "episode-1", number: 1, title: "Pilot", status: "next" },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

const first = submission("a");
const second = submission("b", {
  clipUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
});
const third = submission("c", {
  clipUrl: "https://youtu.be/abcdefghijk?t=75",
  clipStartSeconds: null,
});
const queue = [first, second, third];

async function mount(
  onSave = vi.fn(),
  onDirtyChange = vi.fn(),
  initialId = "a",
  entries = queue,
  showListener = true,
  extra: Partial<Parameters<typeof QuoteClipMarker>[0]> = {}
) {
  await act(async () => {
    view = create(
      <QuoteClipMarker
        initialId={initialId}
        onDirtyChange={onDirtyChange}
        onSave={onSave}
        queue={entries}
        showListener={showListener}
        {...extra}
      />,
      {
        createNodeMock: (node) =>
          node.type === "div"
            ? { appendChild: vi.fn(), replaceChildren: vi.fn() }
            : null,
      }
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
  act(() => events.onReady());
  // The cue seek lands on the next poll, as a real player's would.
  act(() => {
    vi.advanceTimersByTime(100);
  });
  return { onSave, onDirtyChange };
}

// Renders without firing onReady, for a player that fails or is still loading.
async function mountUnready(entries = queue, initialId = "a") {
  await act(async () => {
    view = create(
      <QuoteClipMarker
        initialId={initialId}
        onSave={vi.fn()}
        queue={entries}
      />,
      {
        createNodeMock: (node) =>
          node.type === "div"
            ? { appendChild: vi.fn(), replaceChildren: vi.fn() }
            : null,
      }
    );
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

function press(
  key: string,
  target: unknown = null,
  change: Partial<
    Pick<
      KeyboardEvent,
      | "shiftKey"
      | "metaKey"
      | "ctrlKey"
      | "altKey"
      | "defaultPrevented"
      | "repeat"
    >
  > = {}
) {
  const event = {
    key,
    target,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...change,
  } as unknown as KeyboardEvent;
  act(() => keyListeners.forEach((listener) => listener(event)));
  return event;
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const text = () => textOf(view.root);
const field = (id: string) => view.root.findByProps({ id });
// The player reports `time` on the next poll, which lets a pending seek land.
const settle = (time: number) => {
  media.getCurrentTime.mockReturnValue(time);
  act(() => {
    vi.advanceTimersByTime(100);
  });
};
const messageText = (role: "status" | "alert") =>
  view.root
    .findAllByProps({ role })
    .filter((node) => typeof node.type === "string")
    .map(textOf)
    .join(" ");
const hostButton = (match: (node: ReactTestInstance) => boolean) => {
  const found = view.root.findAllByType("button").find((node) => match(node));
  if (found === undefined) throw new Error("No matching button");
  return found;
};
const buttonNamed = (label: string) =>
  hostButton((node) => textOf(node).trim() === label);

describe("quote clip marker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    media.getCurrentTime.mockReturnValue(0);
    media.getDuration.mockReturnValue(120);
    media.getPlayerState.mockReturnValue(2);
    keyListeners = [];
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3001" },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("document", {
      createElement: () => ({}),
      addEventListener: (_type: string, listener: () => void) =>
        keyListeners.push(listener),
      removeEventListener: (_type: string, listener: () => void) => {
        keyListeners = keyListeners.filter((item) => item !== listener);
      },
    });
    media.seekTo.mockImplementation((seconds: number) => {
      media.getCurrentTime.mockReturnValue(seconds);
    });
    mocks.load.mockResolvedValue({
      Player: class {
        constructor(
          _element: unknown,
          options: ConstructorParameters<YouTubeAPI["Player"]>[1]
        ) {
          playerOptions = options;
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

  test("moving on from an untouched clip saves nothing, and a held Enter doesn't repeat", async () => {
    const onSave = vi.fn();
    await mount(onSave);
    press("Enter");
    expect(onSave).not.toHaveBeenCalled();
    expect(text()).toContain("Clip 2 of 3");
    expect(messageText("status")).toContain("No changes to clip 1.");
    press("Enter", null, { repeat: true });
    expect(text()).toContain("Clip 2 of 3");
  });

  test("an entry switched to another video drops the marks; one that lost its YouTube link leaves", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new EntryChangedError({
          ...first,
          clipUrl: "https://youtu.be/ccccccccccc",
          updatedAt: 2,
        })
      )
      .mockRejectedValueOnce(
        new EntryChangedError({
          ...first,
          clipUrl: "https://vimeo.com/1",
          updatedAt: 3,
        })
      );
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    expect(field("clip-marker-end").props.value).toBe("");
    expect(messageText("alert")).toContain("different video");

    // The new video's player loads and cues before marking again.
    await flush();
    act(() => events.onReady());
    act(() => {
      vi.advanceTimersByTime(100);
    });
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    expect(text()).toContain("Clip 1 of 2");
    expect(messageText("alert")).toContain("no longer links to a YouTube clip");
  });

  test("a cue set while the player is loading is applied once it is ready", async () => {
    await mountUnready([first, third], "a");
    press("j");
    act(() => events.onReady());
    // The second entry's start (link t=75), a second early.
    expect(media.seekTo).toHaveBeenLastCalledWith(74, true);
  });

  test("cueing a player that hasn't started doesn't start it", async () => {
    media.getPlayerState.mockReturnValue(5);
    await mount();
    // The cue after ready seeks, then pauses, since seekTo plays a cued video.
    expect(media.seekTo).toHaveBeenCalledWith(39, true);
    expect(media.pauseVideo).toHaveBeenCalled();
    expect(media.playVideo).not.toHaveBeenCalled();
  });

  test("a step keeps a playing clip playing, and leaves a finished one paused", async () => {
    await mount();
    media.pauseVideo.mockClear();
    media.getPlayerState.mockReturnValue(1);
    press("ArrowLeft");
    expect(media.pauseVideo).not.toHaveBeenCalled();
    settle(38);
    // seekTo would start an ended video playing; the step pauses it.
    media.getPlayerState.mockReturnValue(0);
    press("ArrowLeft");
    expect(media.pauseVideo).toHaveBeenCalledOnce();
  });

  test("steps add up while the player still reports the old time, and a keyframe landing reads true", async () => {
    await mount();
    // A player that keeps reporting 60 until the seek lands.
    media.seekTo.mockImplementation(() => undefined);
    media.getCurrentTime.mockReturnValue(60);
    press("ArrowLeft");
    press("ArrowRight", null, { shiftKey: true });
    expect(media.seekTo).toHaveBeenLastCalledWith(64, true);
    press("e");
    expect(field("clip-marker-end").props.value).toBe("1:04.0");
    // A poll that still reports the old spot doesn't count as landing.
    settle(60);
    press(".");
    expect(media.seekTo).toHaveBeenLastCalledWith(expect.closeTo(64.2), true);
    // It lands on the keyframe before the target; marks read where it is.
    settle(63.6);
    press("s");
    expect(field("clip-marker-start").props.value).toBe("1:03.6");
  });

  test("a replaced seek landing late doesn't count as the new one landing", async () => {
    await mount();
    media.seekTo.mockImplementation(() => undefined);
    media.getCurrentTime.mockReturnValue(10);
    press("ArrowRight", null, { shiftKey: true });
    press("ArrowRight", null, { shiftKey: true });
    press("ArrowLeft", null, { shiftKey: true });
    expect(media.seekTo).toHaveBeenLastCalledWith(15, true);
    // The seek to 20 lands after it was replaced by the step back to 15.
    settle(20);
    press("s");
    expect(field("clip-marker-start").props.value).toBe("0:15.0");
  });

  test("the seek slider keeps the shortcuts, and a held Enter in a field doesn't resubmit", async () => {
    await mount();
    media.getCurrentTime.mockReturnValue(50);
    const slider = {
      closest: (selector: string) =>
        selector.includes("input:not([type='range'])")
          ? null
          : selector.includes("input")
          ? {}
          : null,
    };
    press("s", slider);
    expect(field("clip-marker-start").props.value).toBe("0:50.0");

    const form = view.root.findByType("form");
    const held = { key: "Enter", repeat: true, preventDefault: vi.fn() };
    act(() => form.props.onKeyDown(held));
    expect(held.preventDefault).toHaveBeenCalledOnce();
    const single = { key: "Enter", repeat: false, preventDefault: vi.fn() };
    act(() => form.props.onKeyDown(single));
    expect(single.preventDefault).not.toHaveBeenCalled();
  });

  test("a clip never marked asks for a start on Save, and says it was skipped on Enter", async () => {
    await mount(vi.fn(), vi.fn(), "c", [third, first]);
    act(() => buttonNamed("Save").props.onClick());
    expect(messageText("alert")).toBe("Set a start first.");
    press("Enter");
    expect(text()).toContain("Clip 2 of 2");
    expect(messageText("status")).toContain(
      "Skipped clip 1: it has no start yet."
    );
    press("Enter");
    expect(messageText("status")).toContain(
      "No changes to save. That was the last clip in this view."
    );
  });

  test("an entry scored meanwhile leaves the queue", async () => {
    const onSave = vi.fn(async () => {
      throw new EntryChangedError({ ...first, scored: true, updatedAt: 2 });
    });
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    expect(text()).toContain("Clip 1 of 2");
    expect(messageText("alert")).toContain("has been scored");
  });

  test("marks typed while a save is in flight stay unsaved", async () => {
    let finish: (entry: ConvexAdminQuoteSubmission) => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<ConvexAdminQuoteSubmission>((resolve) => {
          finish = resolve;
        })
    );
    const { onDirtyChange } = await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    act(() => buttonNamed("Save").props.onClick());
    media.getCurrentTime.mockReturnValue(46);
    press("e");
    await act(async () => {
      finish({ ...first, clipEndSeconds: 44 });
      await Promise.resolve();
    });
    expect(field("clip-marker-end").props.value).toBe("0:46.0");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  test("a save that fails after moving on says which clip failed", async () => {
    let fail: (error: unknown) => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<ConvexAdminQuoteSubmission>((_resolve, reject) => {
          fail = reject;
        })
    );
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    press("Enter");
    press("j");
    await act(async () => {
      fail(new Error("Paused"));
      await Promise.resolve();
    });
    expect(text()).toContain("Clip 2 of 3");
    expect(messageText("alert")).toBe("Clip 1 wasn't saved: Paused");
  });

  test("a changed entry is shown in its latest version, keeping the marks", async () => {
    const newer = { ...first, quoteText: "Line a, as edited", updatedAt: 2 };
    const onSave = vi.fn(async () => {
      throw new EntryChangedError(newer);
    });
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    expect(text()).toContain("Line a, as edited");
    expect(text()).toContain("Clip 1 of 3");
    expect(field("clip-marker-end").props.value).toBe("0:44.0");
    expect(messageText("alert")).toContain("check the clip and save again");
  });

  test("a deleted entry leaves the queue and the view stays on its clip", async () => {
    const onSave = vi.fn(async () => {
      throw new EntryChangedError(null);
    });
    await mount(onSave, vi.fn(), "b");
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    // Clip b is gone; c moved up into its place.
    expect(text()).toContain("Clip 2 of 2");
    expect(text()).toContain("Line c");
    expect(messageText("alert")).toContain("This entry was deleted");
  });

  test("moving on while a save is in flight doesn't pull the view back", async () => {
    let finish: (entry: ConvexAdminQuoteSubmission) => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<ConvexAdminQuoteSubmission>((resolve) => {
          finish = resolve;
        })
    );
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    press("Enter");
    press("j");
    press("j");
    expect(text()).toContain("Clip 3 of 3");
    await act(async () => {
      finish({ ...first, clipEndSeconds: 44 });
      await Promise.resolve();
    });
    expect(text()).toContain("Clip 3 of 3");
    expect(text()).toContain("Saved clip 1: 0:40.0 to 0:44.0.");
  });

  test("marks the line with S and E, then saves and moves to the next clip on Enter", async () => {
    const onSave = vi.fn(
      async (
        entry: ConvexAdminQuoteSubmission,
        times: { start: number; end: number | null }
      ) => ({
        ...entry,
        clipStartSeconds: times.start,
        clipEndSeconds: times.end,
      })
    );
    const { onDirtyChange } = await mount(onSave);
    expect(text()).toContain("Clip 1 of 3 · Listener a");
    expect(text()).toContain("starts at 0:40.0, no end");

    media.getCurrentTime.mockReturnValue(42.34);
    press("s");
    media.getCurrentTime.mockReturnValue(44.06);
    press("e");
    expect(field("clip-marker-start").props.value).toBe("0:42.3");
    expect(field("clip-marker-end").props.value).toBe("0:44.1");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(first, { start: 42.3, end: 44.1 });
    expect(text()).toContain("Clip 2 of 3");
    expect(messageText("status")).toContain(
      "Saved the previous clip: 0:42.3 to 0:44.1."
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  test("keeps typing out of the shortcuts and saves typed times", async () => {
    const onSave = vi.fn(async (entry: ConvexAdminQuoteSubmission) => entry);
    await mount(onSave, vi.fn(), "c");
    const input = {
      closest: (selector: string) => (selector.includes("input") ? {} : null),
    };
    press("s", input);
    expect(field("clip-marker-start").props.value).toBe("");

    act(() =>
      field("clip-marker-start").props.onChange({
        target: { value: "1:05.25" },
      })
    );
    await act(async () => {
      view.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(third, { start: 65.3, end: null });
    expect(messageText("status")).toContain("That was the last clip");
  });

  test("refuses an end before the start or unreadable text, and shows save failures", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Quotabunga changes are paused in this environment.");
    });
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(30);
    press("e");
    press("Enter");
    expect(messageText("alert")).toBe("The end must be after the start.");

    act(() =>
      field("clip-marker-end").props.onChange({ target: { value: "0:4x" } })
    );
    press("Enter");
    expect(messageText("alert")).toBe("Times look like 1:05.2 or 65.2.");
    expect(onSave).not.toHaveBeenCalled();

    act(() =>
      field("clip-marker-end").props.onChange({ target: { value: "0:45.0" } })
    );
    await act(async () => {
      press("Enter");
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(messageText("alert")).toBe(
      "Quotabunga changes are paused in this environment."
    );
    expect(text()).toContain("Clip 1 of 3");
  });

  test("P plays the marked line and pauses just after its end", async () => {
    await mount();
    media.getCurrentTime.mockReturnValue(50);
    press("e");
    press("p");
    expect(media.seekTo).toHaveBeenLastCalledWith(40, true);
    expect(media.playVideo).toHaveBeenCalledOnce();

    media.getPlayerState.mockReturnValue(1);
    settle(40.1);
    media.getCurrentTime.mockReturnValue(50.2);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.pauseVideo).not.toHaveBeenCalled();
    media.getCurrentTime.mockReturnValue(50.3);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.pauseVideo).toHaveBeenCalledOnce();
  });

  test("J and K step through the queue and cue each clip a second early", async () => {
    // Both entries use one video, so the player stays and only the playhead moves.
    await mount(vi.fn(), vi.fn(), "a", [first, third]);
    press("j");
    expect(text()).toContain("Clip 2 of 2");
    expect(text()).toContain("Saved clip: no start time");
    // No saved start, so it cues a second before the link's own t=75.
    expect(media.seekTo).toHaveBeenLastCalledWith(74, true);
    press("k");
    expect(text()).toContain("Clip 1 of 2");
    expect(media.seekTo).toHaveBeenLastCalledWith(39, true);
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  test("Done closes the marker, and shortcuts wait while another prompt is open", async () => {
    const onDone = vi.fn();
    await mount(vi.fn(), vi.fn(), "a", queue, true, { onDone, paused: true });
    act(() => buttonNamed("Done").props.onClick());
    expect(onDone).toHaveBeenCalledOnce();
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    press("j");
    expect(field("clip-marker-end").props.value).toBe("");
    expect(text()).toContain("Clip 1 of 3");
  });

  test("leaves the listener's name out while names are hidden", async () => {
    await mount(vi.fn(), vi.fn(), "a", queue, false);
    expect(text()).toContain("Clip 1 of 3");
    expect(text()).not.toContain("Listener a");
  });

  test("a video that can't play embedded offers a retry", async () => {
    await mount();
    act(() => events.onError({ data: 150 }));
    expect(messageText("alert")).toContain(
      "The owner doesn't allow this video to play here."
    );
  });

  test("setting the start at or past the marked end clears the end", async () => {
    await mount();
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    media.getCurrentTime.mockReturnValue(42);
    press("s");
    expect(field("clip-marker-start").props.value).toBe("0:42.0");
    expect(field("clip-marker-end").props.value).toBe("0:44.0");

    media.getCurrentTime.mockReturnValue(44);
    press("s");
    expect(field("clip-marker-start").props.value).toBe("0:44.0");
    expect(field("clip-marker-end").props.value).toBe("");
    expect(messageText("status")).toBe("Start set to 0:44.0.");
  });

  test("asks for a start, and refuses times past 24 hours or past the video's end", async () => {
    const { onSave } = await mount(vi.fn(), vi.fn(), "c");
    // Untouched, the last clip has nothing to save.
    press("Enter");
    expect(messageText("status")).toContain("No changes to save.");
    act(() =>
      field("clip-marker-end").props.onChange({ target: { value: "0:10" } })
    );
    press("Enter");
    expect(messageText("alert")).toBe("Set a start first.");
    act(() =>
      field("clip-marker-end").props.onChange({ target: { value: "" } })
    );

    const typeStart = (value: string) =>
      act(() =>
        field("clip-marker-start").props.onChange({ target: { value } })
      );
    typeStart("25:00:00");
    press("Enter");
    expect(messageText("alert")).toBe("Clip times must be within 24 hours.");

    typeStart("2:30");
    press("Enter");
    expect(messageText("alert")).toBe(
      "The start is past the end of the video."
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  test("Save keeps the clip on screen and ignores repeats while saving; a failure without a reason says so", async () => {
    let finish: (entry: ConvexAdminQuoteSubmission) => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<ConvexAdminQuoteSubmission>((resolve) => {
          finish = resolve;
        })
    );
    await mount(onSave);
    media.getCurrentTime.mockReturnValue(44);
    press("e");
    act(() => buttonNamed("Save").props.onClick());
    press("Enter");
    expect(onSave).toHaveBeenCalledOnce();
    expect(buttonNamed("Save").props.disabled).toBe(true);

    await act(async () => {
      finish({ ...first, clipEndSeconds: 44 });
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(text()).toContain("Clip 1 of 3");
    expect(text()).toContain("Saved clip: 0:40.0 to 0:44.0");
    expect(messageText("status")).toBe("Saved: 0:40.0 to 0:44.0.");
    expect(buttonNamed("Save").props.disabled).toBe(false);

    onSave.mockRejectedValueOnce("offline");
    media.getCurrentTime.mockReturnValue(46);
    press("e");
    await act(async () => {
      buttonNamed("Save").props.onClick();
      await Promise.resolve();
    });
    expect(messageText("alert")).toBe("The clip times weren't saved.");
  });

  test("P without an end previews a few seconds; unreadable times explain instead", async () => {
    await mount();
    press("p");
    expect(media.seekTo).toHaveBeenLastCalledWith(40, true);
    media.getPlayerState.mockReturnValue(1);
    settle(40.1);
    media.getCurrentTime.mockReturnValue(44.2);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.pauseVideo).not.toHaveBeenCalled();
    media.getCurrentTime.mockReturnValue(44.4);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(media.pauseVideo).toHaveBeenCalledOnce();

    media.playVideo.mockClear();
    act(() =>
      field("clip-marker-start").props.onChange({ target: { value: "soon" } })
    );
    press("p");
    expect(messageText("alert")).toBe("Times look like 1:05.2 or 65.2.");
    expect(media.playVideo).not.toHaveBeenCalled();
  });

  test("arrow, comma and period keys step the playhead within the video; modified keys, unknown keys and Space or Enter on a focused button are left alone", async () => {
    const { onSave } = await mount();
    media.getCurrentTime.mockReturnValue(60);
    press("ArrowLeft");
    expect(media.seekTo).toHaveBeenLastCalledWith(59, true);
    // Steps pressed before a seek lands add up from its target.
    press("ArrowRight", null, { shiftKey: true });
    expect(media.seekTo).toHaveBeenLastCalledWith(64, true);
    press(",");
    expect(media.seekTo).toHaveBeenLastCalledWith(expect.closeTo(63.8), true);
    press(".");
    expect(media.seekTo).toHaveBeenLastCalledWith(expect.closeTo(64), true);

    settle(64);
    media.getCurrentTime.mockReturnValue(118);
    press("ArrowRight", null, { shiftKey: true });
    expect(media.seekTo).toHaveBeenLastCalledWith(120, true);
    settle(120);
    media.getCurrentTime.mockReturnValue(2);
    press("ArrowLeft", null, { shiftKey: true });
    expect(media.seekTo).toHaveBeenLastCalledWith(0, true);
    settle(0);

    media.seekTo.mockClear();
    media.getCurrentTime.mockReturnValue(60);
    for (const change of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { defaultPrevented: true },
    ]) {
      const event = press("ArrowLeft", null, change);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(press("x").preventDefault).not.toHaveBeenCalled();
    expect(media.seekTo).not.toHaveBeenCalled();

    // A fake element that matches selector lists naming its own tag.
    const focused = (tag: string) => ({
      closest: (selector: string) =>
        selector.split(", ").includes(tag) ? {} : null,
    });
    const focusedButton = focused("button");
    press(" ", focusedButton);
    press("Enter", focusedButton);
    // The keyboard tips' <summary> opens with Enter; it must not save.
    press("Enter", focused("summary"));
    press(" ", focused("summary"));
    expect(media.playVideo).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    // Letter shortcuts still work from a focused button, in either case.
    press("S", focusedButton);
    expect(field("clip-marker-start").props.value).toBe("1:00.0");
  });

  test("Space plays and pauses, and the speed button cycles the playback rate", async () => {
    await mount();
    expect(media.setPlaybackRate).toHaveBeenLastCalledWith(1);
    press(" ");
    expect(media.playVideo).toHaveBeenCalledOnce();
    media.getPlayerState.mockReturnValue(1);
    press(" ");
    expect(media.pauseVideo).toHaveBeenCalledOnce();

    const speed = () =>
      hostButton((node) => node.props.title === "Playback speed");
    for (const rate of [0.75, 0.5, 1]) {
      act(() => speed().props.onClick());
      expect(media.setPlaybackRate).toHaveBeenLastCalledWith(rate);
      expect(speed().props["aria-label"]).toBe(
        `Playback speed ${String(rate)}×`
      );
    }
  });

  test("a player that can't load says why, ignores marks, and Retry loads it again", async () => {
    mocks.load.mockRejectedValueOnce(
      new Error("YouTube could not load. Check your connection or try again.")
    );
    await mountUnready();
    expect(messageText("alert")).toContain(
      "YouTube could not load. Check your connection or try again. Open it on YouTube and type the times in, or try again."
    );
    press("s");
    expect(field("clip-marker-start").props.value).toBe("0:40.0");
    expect(messageText("status")).toBe("");

    act(() => buttonNamed("Retry").props.onClick());
    await flush();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(messageText("status")).toBe("Loading the YouTube player…");
    act(() => events.onReady());
    expect(messageText("alert")).toBe("");
    // Once ready, the player is cued a second before the saved start.
    press("s");
    expect(messageText("status")).toBe("Start set to 0:39.0.");
  });

  test("moving to an entry with another video replaces the player", async () => {
    await mount();
    expect(playerOptions).toMatchObject({
      videoId: "abcdefghijk",
      playerVars: { start: 39, origin: "http://localhost:3001" },
    });
    press("j");
    await flush();
    expect(media.destroy).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(playerOptions).toMatchObject({
      videoId: "bbbbbbbbbbb",
      playerVars: { start: 39 },
    });
  });

  test("starts at the first clip when the requested entry isn't queued, and says when none are", async () => {
    await mount(vi.fn(), vi.fn(), "missing");
    expect(text()).toContain("Clip 1 of 3");
    act(() => view.unmount());

    await mountUnready([]);
    expect(text()).toBe("No entries with a YouTube link in this view.");
  });
});

describe("clip times update", () => {
  test("rewrites the link to open at the new start and keeps the rest", () => {
    const entry = submission("a");
    expect(
      clipTimesUpdate(entry, "abcdefghijk", { start: 42.3, end: 44.1 })
    ).toEqual({
      id: "a",
      quoteText: "Line a",
      sourceTitle: "Heat",
      sourceType: "MOVIE",
      clipUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=42s",
      clipStartSeconds: 42.3,
      clipEndSeconds: 44.1,
      listenerNotes: "From the diner scene",
      adminNotes: "Check the audio",
    });
  });

  test("sends an end only to set one or clear a saved one", () => {
    expect(
      "clipEndSeconds" in
        clipTimesUpdate(submission("a"), "abcdefghijk", {
          start: 0.5,
          end: null,
        })
    ).toBe(false);
    expect(
      clipTimesUpdate(submission("a", { clipEndSeconds: 50 }), "abcdefghijk", {
        start: 0.5,
        end: null,
      })
    ).toMatchObject({
      clipUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      clipEndSeconds: null,
    });
  });
});
