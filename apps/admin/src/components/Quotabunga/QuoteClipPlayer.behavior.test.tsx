import type * as YouTubeModule from "@bbpc/youtube";
import type { YouTubeAPI } from "@bbpc/youtube";
import type { ReactElement } from "react";
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

import { InlineQuoteClip, QuoteClipPlayer } from "./QuoteClipPlayer";

const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const media = {
  destroy: vi.fn(),
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  seekTo: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  getDuration: vi.fn(() => 120),
  getPlayerState: vi.fn(() => PAUSED),
  setPlaybackRate: vi.fn(),
};
let events: ConstructorParameters<YouTubeAPI["Player"]>[1]["events"];
let view: ReactTestRenderer;

async function mount(element: ReactElement) {
  await act(async () => {
    view = create(element, {
      createNodeMock: (node) =>
        node.type === "div"
          ? { appendChild: vi.fn(), replaceChildren: vi.fn() }
          : null,
    });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

const ready = () => act(() => events.onReady());
const tick = (time: number, state: number) => {
  media.getCurrentTime.mockReturnValue(time);
  media.getPlayerState.mockReturnValue(state);
  act(() => {
    vi.advanceTimersByTime(100);
  });
};
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const text = () => textOf(view.root);
const button = (label: string) => {
  const found = view.root
    .findAllByType("button")
    .find((node) => textOf(node).trim().startsWith(label));
  if (found === undefined) throw new Error(`No button labeled ${label}`);
  return found;
};
const click = (label: string) => act(() => button(label).props.onClick());

function submission(
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id: "quote-1",
    quoteText: "You talkin' to me?",
    sourceTitle: "Taxi Driver",
    sourceType: "MOVIE",
    clipUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=40s",
    clipStartSeconds: 40,
    clipEndSeconds: 44.1,
    listenerNotes: null,
    status: "INCLUDED",
    bracketOrder: 1,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
    userId: "user-1",
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: null,
    user: { id: "user-1", name: "Listener", email: null, image: null },
    episode: { id: "episode-1", number: 1, title: "Pilot", status: "next" },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

describe("quote clip player", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    media.getCurrentTime.mockReturnValue(40);
    media.getPlayerState.mockReturnValue(PAUSED);
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3001" },
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

  test("plays the marked clip as soon as it loads and pauses at its end", async () => {
    await mount(
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    expect(text()).toContain("Loading the clip");
    ready();
    expect(media.seekTo).toHaveBeenCalledWith(40, true);
    expect(media.playVideo).toHaveBeenCalledOnce();

    // The seek lands, then playback runs to the end.
    tick(40.1, PLAYING);
    tick(44, PLAYING);
    expect(media.pauseVideo).not.toHaveBeenCalled();
    tick(44.1, PLAYING);
    expect(media.pauseVideo).toHaveBeenCalledOnce();
    expect(text()).toContain("clip 0:40.0–0:44.1");
  });

  test("Play clip resumes a paused clip and restarts a finished one; Replay always restarts", async () => {
    await mount(
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    tick(40.1, PLAYING);
    tick(42, PLAYING);
    click("Pause");
    expect(media.pauseVideo).toHaveBeenCalledOnce();

    tick(42, PAUSED);
    click("Play clip");
    expect(media.seekTo).toHaveBeenLastCalledWith(42, true);

    tick(42.1, PLAYING);
    tick(44.2, PAUSED);
    click("Play clip");
    expect(media.seekTo).toHaveBeenLastCalledWith(40, true);

    tick(41, PAUSED);
    click("Replay");
    expect(media.seekTo).toHaveBeenLastCalledWith(40, true);
  });

  test("a replay from past the end waits for its seek before stopping", async () => {
    await mount(
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    tick(40.1, PLAYING);
    tick(44.2, PLAYING);
    expect(media.pauseVideo).toHaveBeenCalledOnce();

    click("Replay");
    // YouTube still reports the old spot (or ENDED) until the seek lands.
    tick(44.2, PLAYING);
    tick(44.3, 0);
    expect(media.pauseVideo).toHaveBeenCalledOnce();
    tick(40.1, PLAYING);
    tick(44.1, PLAYING);
    expect(media.pauseVideo).toHaveBeenCalledTimes(2);
  });

  test("a short clip starting where the player is still stops at its end when the first poll is late", async () => {
    await mount(
      <QuoteClipPlayer
        end={40.5}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    // Playback has already carried the time past the start.
    tick(40.2, PLAYING);
    tick(40.5, PLAYING);
    expect(media.pauseVideo).toHaveBeenCalledOnce();
  });

  test("a seek still buffering keeps the clip's end until it lands", async () => {
    media.getCurrentTime.mockReturnValue(80);
    await mount(
      <QuoteClipPlayer
        end={44}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    for (let poll = 0; poll < 30; poll += 1) tick(80, BUFFERING);
    expect(media.pauseVideo).not.toHaveBeenCalled();
    tick(40.1, PLAYING);
    tick(44, PLAYING);
    expect(media.pauseVideo).toHaveBeenCalledOnce();
  });

  test("a video refused before the player is ready stays refused", async () => {
    await mount(
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    act(() => events.onError({ data: 150 }));
    ready();
    tick(40, PAUSED);
    expect(media.seekTo).not.toHaveBeenCalled();
    expect(textOf(view.root.findByProps({ role: "alert" }))).toContain(
      "The owner doesn't allow this video to play here."
    );
    expect(button("Play clip").props.disabled).toBe(true);
  });

  test("a clip without an end plays on until paused", async () => {
    await mount(
      <QuoteClipPlayer
        end={null}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    tick(90, PLAYING);
    expect(media.pauseVideo).not.toHaveBeenCalled();
    expect(text()).toContain("clip from 0:40.0");
  });

  test("an error after the player is ready stays on screen", async () => {
    await mount(
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    // Embed refusals usually arrive once playback starts, after onReady.
    act(() => events.onError({ data: 150 }));
    tick(40, PAUSED);
    tick(40, PAUSED);
    expect(textOf(view.root.findByProps({ role: "alert" }))).toContain(
      "The owner doesn't allow this video to play here."
    );
    expect(button("Play clip").props.disabled).toBe(true);
  });

  test("says when autoplay was blocked and links to YouTube when the video can't play", async () => {
    await mount(
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    act(() => events.onAutoplayBlocked());
    ready();
    expect(text()).toContain("Press Play clip to start it.");
    act(() => events.onError({ data: 150 }));
    const alert = view.root.findByProps({ role: "alert" });
    expect(textOf(alert)).toContain(
      "The owner doesn't allow this video to play here."
    );
    expect(alert.findByType("a").props.href).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=40s"
    );
  });

  test("stops when the video ends before the marked end, and reads a missing time as zero", async () => {
    await mount(
      <QuoteClipPlayer
        end={200}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    ready();
    tick(40.1, PLAYING);
    tick(119, PLAYING);
    expect(media.pauseVideo).not.toHaveBeenCalled();
    tick(120, 0);
    expect(media.pauseVideo).toHaveBeenCalledOnce();
    // The video itself ended, so Play clip starts the clip over.
    click("Play clip");
    expect(media.seekTo).toHaveBeenLastCalledWith(40, true);

    tick(40.1, PAUSED);
    tick(Number.NaN, PAUSED);
    expect(text()).toContain("0:00.0 · clip 0:40.0–3:20.0");
  });

  test("explains private videos, other player errors, and a player that never gets ready", async () => {
    const alertText = () =>
      view.root
        .findAllByProps({ role: "alert" })
        .filter((node) => typeof node.type === "string")
        .map(textOf)
        .join(" ");
    const clip = (
      <QuoteClipPlayer
        end={44.1}
        onClose={vi.fn()}
        start={40}
        videoId="abcdefghijk"
      />
    );
    await mount(clip);
    ready();
    act(() => events.onError({ data: 100 }));
    expect(alertText()).toContain("This video is private or was removed.");
    expect(button("Play clip").props.disabled).toBe(true);
    act(() => events.onError({ data: 5 }));
    expect(alertText()).toContain("YouTube couldn't play this video.");
    act(() => view.unmount());

    await mount(clip);
    act(() => {
      vi.advanceTimersByTime(19_999);
    });
    expect(alertText()).toBe("");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(alertText()).toContain("YouTube is taking too long to respond.");
  });

  test("an open clip whose range changes on a refresh plays the new range", async () => {
    const refresh = async (entry: ConvexAdminQuoteSubmission) =>
      act(async () => {
        view.update(
          <InlineQuoteClip onOpenChange={vi.fn()} open submission={entry} />
        );
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
      });
    await mount(
      <InlineQuoteClip onOpenChange={vi.fn()} open submission={submission()} />
    );
    ready();
    expect(media.seekTo).toHaveBeenLastCalledWith(40, true);

    // A refresh with the same range keeps the player as it is.
    await refresh(submission());
    expect(media.destroy).not.toHaveBeenCalled();

    await refresh(submission({ clipStartSeconds: 60, clipEndSeconds: 62 }));
    expect(media.destroy).toHaveBeenCalledOnce();
    ready();
    expect(media.seekTo).toHaveBeenLastCalledWith(60, true);
    tick(60.1, PLAYING);
    tick(62, PLAYING);
    expect(media.pauseVideo).toHaveBeenCalledOnce();
  });
});

describe("inline quote clip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:3001" },
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  test("offers the marked range, then swaps in the player until closed", async () => {
    const onOpenChange = vi.fn();
    await mount(
      <InlineQuoteClip
        onOpenChange={onOpenChange}
        open={false}
        submission={submission()}
      />
    );
    expect(textOf(button("Play clip"))).toContain("Play clip 0:40.0–0:44.1");
    click("Play clip");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await act(async () =>
      view.update(
        <InlineQuoteClip
          onOpenChange={onOpenChange}
          open
          submission={submission()}
        />
      )
    );
    expect(view.root.findAllByType(QuoteClipPlayer)).toHaveLength(1);
    click("Close");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  test("starts where the link does when no start was saved, and skips other links", async () => {
    await mount(
      <InlineQuoteClip
        onOpenChange={vi.fn()}
        open={false}
        submission={submission({
          clipUrl: "https://youtu.be/abcdefghijk?t=75",
          clipStartSeconds: null,
          clipEndSeconds: null,
        })}
      />
    );
    expect(textOf(button("Play clip"))).toContain("Play clip from 1:15.0");

    await act(async () =>
      view.update(
        <InlineQuoteClip
          onOpenChange={vi.fn()}
          open={false}
          submission={submission({ clipUrl: "https://vimeo.com/1" })}
        />
      )
    );
    expect(view.toJSON()).toBeNull();
  });
});
