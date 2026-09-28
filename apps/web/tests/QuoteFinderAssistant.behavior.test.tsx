import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  QuoteFinderAssistant,
  useAssistantAccess,
} from "@/components/QuoteFinderAssistant";
import { useYouTubeSearch, type YouTubeSearch } from "@/hooks/useYouTubeSearch";

const FIRST = "aaaaaaaaaaa";
const SECOND = "bbbbbbbbbbb";
const THIRD = "ccccccccccc";

const fetchMock = vi.fn();
const onFound = vi.fn();
const onUseWording = vi.fn();
let view: ReactTestRenderer;
let search: YouTubeSearch;
let available = true;
let locateReplies: Array<(init: RequestInit) => Promise<Response> | Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const video = (id: string) => ({ id, title: `Scene ${id}` });
const found = (id: string, remaining: string[]) =>
  json({
    status: "found",
    video: video(id),
    start: 64.7,
    end: 67.75,
    spokenText: "You talkin' to me?",
    match: "likely",
    remaining,
  });
const missed = (id: string, reason: string, remaining: string[]) =>
  json({ status: "not_found", video: video(id), reason, remaining });

const onShowPlayer = vi.fn();
const focus = vi.fn();

function Assistant({
  available = true,
  quoteText = "You talking to me",
  sourceTitle = "Taxi Driver",
  hasClip = false,
  loadedVideoId,
  clipStart,
  clipEnd,
}: {
  available?: boolean | null;
  quoteText?: string;
  sourceTitle?: string;
  hasClip?: boolean;
  loadedVideoId?: string;
  clipStart?: string;
  clipEnd?: string;
}) {
  // The finder freezes its query when it opens, as QuotabungaClipFields does.
  search = useYouTubeSearch("Taxi Driver You talking to me");
  // The real page-wide access, with availability set by the test.
  const access = { ...useAssistantAccess(), available };
  return (
    <QuoteFinderAssistant
      access={access}
      search={search}
      quoteText={quoteText}
      sourceTitle={sourceTitle}
      sourceType="MOVIE"
      hasClip={hasClip}
      loadedVideoId={loadedVideoId}
      clipStart={clipStart}
      clipEnd={clipEnd}
      onFound={onFound}
      onUseWording={onUseWording}
      onShowPlayer={onShowPlayer}
    />
  );
}

async function mount(element = <Assistant />) {
  await act(async () => {
    // The status line is the panel's focus target.
    view = create(element, {
      createNodeMock: (node) =>
        node.type === "p" && node.props.tabIndex === -1
          ? { focus }
          : node.type === "section"
          ? { contains: () => false }
          : null,
    });
  });
}
function text(instance: ReactTestInstance = view.root): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
}
function button(label: string) {
  const match = view.root
    .findAllByType("button")
    .find((item) => text(item) === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
async function click(label: string) {
  await act(async () => {
    button(label).props.onClick();
  });
}
const locateBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init.body)).videoIds);
const searches = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/youtube/search")
  );

beforeEach(() => {
  available = true;
  locateReplies = [];
  fetchMock.mockReset();
  onFound.mockReset();
  onUseWording.mockReset();
  onShowPlayer.mockReset();
  focus.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/quote-finder/locate" && !init?.method)
      return json({ available });
    if (url.startsWith("/api/youtube/search"))
      return json({
        videos: [FIRST, SECOND, THIRD].map((id) => ({
          ...video(id),
          channel: "Movies",
        })),
        nextPageToken: null,
      });
    const reply = locateReplies.shift();
    if (!reply) throw new Error("Unexpected locate request");
    return reply(init ?? {});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => view.unmount());
  vi.unstubAllGlobals();
});

test("stays hidden until the route offers the assistant", async () => {
  await mount(<Assistant available={false} />);
  expect(view.toJSON()).toBeNull();
  act(() => view.update(<Assistant available={null} />));
  expect(view.toJSON()).toBeNull();
});

test("asks the route once per page, and again after an answer that isn't definite", async () => {
  const probe: { access: ReturnType<typeof useAssistantAccess> | null } = {
    access: null,
  };
  function Probe() {
    probe.access = useAssistantAccess();
    return null;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const check = async () =>
    act(async () => {
      probe.access?.check();
      await settle();
    });
  await act(async () => {
    view = create(<Probe />);
  });
  fetchMock.mockRejectedValueOnce(new TypeError("offline"));
  await check();
  expect(probe.access?.available).toBeNull();
  // A sign-in hiccup answers 401; that isn't a final no either.
  fetchMock.mockResolvedValueOnce(json({ available: false }, 401));
  await check();
  expect(probe.access?.available).toBeNull();
  available = false;
  await check();
  expect(probe.access?.available).toBe(false);
  await check();
  const gets = fetchMock.mock.calls.filter(
    ([url, init]) => url === "/api/quote-finder/locate" && !init?.method
  );
  expect(gets).toHaveLength(3);
});

test("a refusal holds across openings until its retry time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 8, 28, 20));
  try {
    await mount();
    locateReplies.push(
      () =>
        new Response(
          JSON.stringify({ error: "Try in a minute.", disabled: true }),
          { status: 429, headers: { "Retry-After": "60" } }
        )
    );
    await click("Find it for me");
    expect(text()).toContain("Try in a minute.");
    expect(() => button("Find it for me")).toThrow();
    expect(() => button("Try again")).toThrow();
    vi.setSystemTime(Date.UTC(2026, 8, 28, 20, 1, 1));
    await act(async () => {
      view.update(<Assistant />);
    });
    expect(button("Try again")).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

test("asks for a quote and a source before offering to search", async () => {
  await mount(<Assistant quoteText="  " />);
  expect(text()).toContain(
    "add your quote and the movie or show to the form, then open it again"
  );
  expect(() => button("Find it for me")).toThrow();
});

test("searches once, then checks the results and loads what it heard", async () => {
  await mount();
  locateReplies.push(() => found(SECOND, [THIRD]));
  await click("Find it for me");
  expect(searches()).toHaveLength(1);
  expect(locateBodies()).toEqual([[FIRST, SECOND, THIRD]]);
  expect(onFound).toHaveBeenCalledWith(SECOND, 64.7, 67.75);
  expect(search.resultsOpen).toBe(false);
  expect(text()).toContain(`Heard in “Scene ${SECOND}” at 1:04.7–1:07.8`);
  expect(text()).toContain("“You talkin' to me?”");
  expect(text()).not.toContain("don’t quite match");
  act(() => button("Use exact wording").props.onClick());
  expect(onUseWording).toHaveBeenCalledWith("You talkin' to me?");

  // "Not it" spends one more run on the next candidate only.
  locateReplies.push(() => missed(THIRD, "not_heard", []));
  await click("Not it, try the next video");
  expect(locateBodies()).toEqual([[FIRST, SECOND, THIRD], [THIRD]]);
  expect(text()).toContain(`Didn't hear the line in “Scene ${THIRD}”.`);
  expect(text()).toContain("No more videos to check from this search.");
  expect(searches()).toHaveLength(1);
});

test("reuses results the listener already has instead of searching again", async () => {
  await mount();
  await act(async () => {
    await search.search();
  });
  expect(searches()).toHaveLength(1);
  locateReplies.push(() =>
    json({
      status: "found",
      video: video(FIRST),
      start: 1,
      end: 3,
      spokenText: "Something else entirely",
      match: "possible",
      remaining: [],
    })
  );
  await click("Find it for me");
  expect(searches()).toHaveLength(1);
  expect(text()).toContain(`Might be in “Scene ${FIRST}”`);
  expect(text()).toContain("the words don’t quite match your quote");
});

test("offers a retry after a slow check and after a failed one", async () => {
  await mount();
  locateReplies.push(() => missed(FIRST, "timeout", [SECOND]));
  await click("Find it for me");
  expect(text()).toContain(`“Scene ${FIRST}” took too long to check.`);
  locateReplies.push(() => json({ error: "Try later." }, 503));
  await click("Try again");
  expect(locateBodies()[1]).toEqual([FIRST, SECOND]);
  expect(text()).toContain("Try later.");
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Try again");
  expect(locateBodies()[2]).toEqual([FIRST, SECOND]);
  expect(onFound).toHaveBeenCalledOnce();
});

test("a spent budget disables the assistant with the route's reason", async () => {
  await mount();
  const reason =
    "You've used your assistant runs for now. Try again in 12 hours, or search and pick a clip yourself.";
  locateReplies.push(() => json({ error: reason, disabled: true }, 429));
  await click("Find it for me");
  expect(text()).toContain(reason);
  expect(() => button("Find it for me")).toThrow();
  expect(() => button("Try again")).toThrow();
  // A new search doesn't bring the button back.
  act(() => search.setQuery("Taxi Driver mirror"));
  expect(text()).toContain(reason);
  expect(() => button("Find it for me")).toThrow();
});

test("cancel stops waiting and ignores the late answer", async () => {
  await mount();
  let signal: AbortSignal | undefined;
  let answer: (response: Response) => void = () => undefined;
  locateReplies.push(
    (init) =>
      new Promise<Response>((resolve) => {
        signal = init.signal ?? undefined;
        answer = resolve;
      })
  );
  await click("Find it for me");
  expect(text()).toContain("Listening for the line…");
  await click("Cancel");
  expect(signal?.aborted).toBe(true);
  await act(async () => answer(found(FIRST, [])));
  expect(onFound).not.toHaveBeenCalled();
  expect(text()).toContain("Stopped. Nothing new was loaded.");
  expect(button("Find it for me")).toBeDefined();
});

test("cancelling Not it returns to the suggestion instead of starting over", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  // The form now holds the suggestion.
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={FIRST} />);
  });
  locateReplies.push(() => new Promise<Response>(() => undefined));
  await click("Not it, try the next video");
  // The row keeps its buttons, disabled, with Cancel last.
  expect(button("Not it, try the next video").props.disabled).toBe(true);
  expect(button("Show player").props.disabled).toBe(true);
  await click("Cancel");
  expect(text()).toContain(`Heard in “Scene ${FIRST}”`);
  expect(button("Not it, try the next video").props.disabled).toBe(false);
});

test("cancel doesn't bring back a suggestion replaced during the run", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={FIRST} />);
  });
  locateReplies.push(() => new Promise<Response>(() => undefined));
  await click("Not it, try the next video");
  // The listener pastes another video while the check runs.
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={THIRD} />);
  });
  await click("Cancel");
  expect(text()).toContain("Stopped. Nothing new was loaded.");
  expect(text()).not.toContain("It’s loaded in the quote player");
});

test("says why nothing was checked when no video qualifies", async () => {
  await mount();
  locateReplies.push(() =>
    json({
      status: "not_found",
      video: null,
      reason: "no_candidates",
      remaining: [],
    })
  );
  await click("Find it for me");
  expect(text()).toContain("public videos up to 3 minutes long");
  expect(text()).toContain("Try another search below");
});

test("explains a search that failed, found nothing or is too short to run", async () => {
  await mount();
  fetchMock.mockImplementationOnce(
    async () => new Response("quota", { status: 503 })
  );
  await click("Find it for me");
  expect(text()).toContain(
    "The video search didn't finish. See the note under Find a video."
  );
  expect(search.results?.error).toContain("unavailable");
  // A failed search isn't reused; the next press searches again.
  fetchMock.mockImplementationOnce(async () =>
    json({ videos: [], nextPageToken: null })
  );
  await click("Find it for me");
  expect(searches()).toHaveLength(2);
  expect(text()).toContain("The search found no videos.");
  act(() => search.setQuery("a"));
  await click("Find it for me");
  expect(text()).toContain("Type a search under Find a video first.");
  expect(searches()).toHaveLength(2);
  expect(locateBodies()).toEqual([]);
});

test("a failed, garbled or unreachable check offers the same videos again", async () => {
  await mount();
  const unavailable = "The assistant is unavailable right now.";
  locateReplies.push(
    () => new Response("<html>Bad gateway</html>", { status: 502 })
  );
  await click("Find it for me");
  expect(text()).toContain(unavailable);
  locateReplies.push(() => json({ status: "found", video: video(FIRST) }));
  await click("Try again");
  expect(text()).toContain(unavailable);
  locateReplies.push(() => Promise.reject(new TypeError("Failed to fetch")));
  await click("Try again");
  expect(text()).toContain(unavailable);
  expect(locateBodies()).toEqual([
    [FIRST, SECOND, THIRD],
    [FIRST, SECOND, THIRD],
    [FIRST, SECOND, THIRD],
  ]);
  expect(onFound).not.toHaveBeenCalled();
  expect(searches()).toHaveLength(1);
});

test("editing the search keeps a paid check running, and Not it moves into the new results", async () => {
  await mount();
  let signal: AbortSignal | undefined;
  let answer: (response: Response) => void = () => undefined;
  locateReplies.push(
    (init) =>
      new Promise<Response>((resolve) => {
        signal = init.signal ?? undefined;
        answer = resolve;
      })
  );
  await click("Find it for me");
  act(() => search.setQuery("Taxi Driver mirror scene"));
  expect(signal?.aborted).toBe(false);
  expect(text()).toContain("Listening for the line…");
  await act(async () => answer(found(FIRST, [SECOND, THIRD])));
  expect(onFound).toHaveBeenCalledWith(FIRST, 64.7, 67.75);
  expect(text()).toContain(`Heard in “Scene ${FIRST}”`);

  // The new search lists the same videos; the one already checked is skipped.
  await act(async () => {
    await search.search();
  });
  locateReplies.push(() => found(THIRD, []));
  await click("Not it, try the next video");
  expect(locateBodies()[1]).toEqual([SECOND, THIRD]);
});

test("a search replaced while the assistant waits for it isn't an error", async () => {
  await mount();
  fetchMock.mockImplementationOnce(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        )
      )
  );
  await click("Find it for me");
  expect(text()).toContain("Finding videos to check…");
  focus.mockClear();
  await act(async () => {
    search.setQuery("Taxi Driver mirror scene");
  });
  expect(text()).toContain(
    "The search changed. Press Find it for me to check the new results."
  );
  expect(text()).not.toContain("didn't finish");
  expect(focus).not.toHaveBeenCalled();
  expect(locateBodies()).toEqual([]);
});

test("cancel while searching checks nothing and waits for the search to finish", async () => {
  await mount();
  let finish: (response: Response) => void = () => undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  await click("Find it for me");
  expect(text()).toContain("Finding videos to check…");
  await click("Cancel");
  // The listener's search is still running; its results come next.
  expect(button("Find it for me").props.disabled).toBe(true);
  await act(async () =>
    finish(
      json({
        videos: [{ ...video(FIRST), channel: "Movies" }],
        nextPageToken: null,
      })
    )
  );
  expect(locateBodies()).toEqual([]);
  expect(search.results?.videos.map(({ id }) => id)).toEqual([FIRST]);
  expect(button("Find it for me").props.disabled).toBe(false);
});

test("checks a page of results at a time, then moves on to later listed results", async () => {
  await mount();
  const ids = Array.from(
    { length: 9 },
    (_, index) => `video${String(index).padStart(6, "0")}`
  );
  const page = (slice: string[], nextPageToken: string | null) =>
    json({
      videos: slice.map((id) => ({ ...video(id), channel: "Movies" })),
      nextPageToken,
    });
  fetchMock.mockImplementationOnce(async () => page(ids.slice(0, 6), "p2"));
  fetchMock.mockImplementationOnce(async () => page(ids.slice(6), null));
  await act(async () => {
    await search.search();
  });
  await act(async () => {
    await search.search(true);
  });
  expect(search.results?.videos).toHaveLength(9);
  const top = ids[0] ?? FIRST;
  locateReplies.push(() => missed(top, "unreadable", ids.slice(1, 6)));
  await click("Find it for me");
  expect(locateBodies()).toEqual([ids.slice(0, 6)]);
  expect(text()).toContain(`Couldn't listen to “Scene ${top}”.`);
  // The route's five leftovers, topped up with the next listed video.
  locateReplies.push(() => missed(ids[1] ?? SECOND, "not_heard", []));
  await click("Try the next video");
  expect(locateBodies()[1]).toEqual(ids.slice(1, 7));
  // The route checked or skipped all six; the last two listed are next.
  locateReplies.push(() => missed(ids[7] ?? THIRD, "not_heard", []));
  await click("Try the next video");
  expect(locateBodies()[2]).toEqual(ids.slice(7));
  expect(text()).toContain("No more videos to check from this search.");
});

test("closing the finder stops a check in flight", async () => {
  await mount();
  let signal: AbortSignal | undefined;
  locateReplies.push(
    (init) =>
      new Promise<Response>(() => {
        signal = init.signal ?? undefined;
      })
  );
  await click("Find it for me");
  expect(signal?.aborted).toBe(false);
  act(() => view.unmount());
  expect(signal?.aborted).toBe(true);
});

test("a double press spends one search and one check", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, []));
  await act(async () => {
    const press = button("Find it for me").props.onClick;
    press();
    press();
  });
  expect(searches()).toHaveLength(1);
  expect(locateBodies()).toHaveLength(1);
  expect(onFound).toHaveBeenCalledOnce();
  expect(text()).toContain(`Heard in “Scene ${FIRST}”`);
});

test("later checks look for the listener's own line, which Restore brings back", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  act(() => button("Use exact wording").props.onClick());
  expect(onUseWording).toHaveBeenLastCalledWith("You talkin' to me?");
  // The form now holds the heard line.
  await act(async () => {
    view.update(<Assistant quoteText="You talkin' to me?" />);
  });
  expect(text()).toContain("Your quote now uses this wording.");
  locateReplies.push(() => missed(SECOND, "not_heard", []));
  await click("Not it, try the next video");
  const sent = fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init.body)).quoteText);
  expect(sent).toEqual(["You talking to me", "You talking to me"]);
  // The rejected video's wording is still in the form; offer it back.
  act(() => button("Restore my wording").props.onClick());
  expect(onUseWording).toHaveBeenLastCalledWith("You talking to me");
});

test("says so when the heard line is already the listener's quote", async () => {
  await mount(<Assistant quoteText="You talkin' to me?" />);
  locateReplies.push(() => found(FIRST, []));
  await click("Find it for me");
  expect(text()).toContain("It matches your quote.");
  expect(() => button("Use exact wording")).toThrow();
  expect(() => button("Restore my wording")).toThrow();
});

test("starting over skips videos this session already checked", async () => {
  await mount(<Assistant loadedVideoId={SECOND} />);
  locateReplies.push(() => found(FIRST, [SECOND, THIRD]));
  await click("Find it for me");
  // Another video loaded by hand retires the suggestion.
  await act(async () => {
    view.update(<Assistant loadedVideoId={THIRD} />);
  });
  locateReplies.push(() => missed(SECOND, "not_heard", []));
  await click("Find it for me");
  expect(locateBodies()[1]).toEqual([SECOND, THIRD]);
  // Every listed video is checked now; nothing is left to pay for.
  expect(() => button("Try the next video")).toThrow();
  expect(text()).toContain("No more videos to check from this search.");
});

test("a video loaded by hand retires the heard line", async () => {
  await mount(<Assistant loadedVideoId={SECOND} />);
  locateReplies.push(() => found(FIRST, [THIRD]));
  await click("Find it for me");
  await act(async () => {
    view.update(<Assistant loadedVideoId={FIRST} />);
  });
  expect(text()).toContain(`Heard in “Scene ${FIRST}”`);
  await act(async () => {
    view.update(<Assistant loadedVideoId={THIRD} />);
  });
  expect(text()).not.toContain("Heard in");
  expect(() => button("Use exact wording")).toThrow();
  expect(button("Find it for me")).toBeDefined();
});

test("a suggestion waits for Load it when the form holds the listener's own clip", async () => {
  await mount(<Assistant hasClip loadedVideoId="zzzzzzzzzzz" />);
  locateReplies.push(() => found(FIRST, []));
  await click("Find it for me");
  expect(onFound).not.toHaveBeenCalled();
  expect(text()).toContain("Load it to replace the clip in your form.");
  expect(() => button("Use exact wording")).toThrow();
  await click("Load it");
  expect(onFound).toHaveBeenCalledWith(FIRST, 64.7, 67.75);
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={FIRST} />);
  });
  expect(text()).toContain("It’s loaded in the quote player below.");
  act(() => button("Show player").props.onClick());
  expect(onShowPlayer).toHaveBeenCalledOnce();
});

test("the assistant's own suggestion is replaced without asking", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={FIRST} />);
  });
  locateReplies.push(() => found(SECOND, []));
  await click("Not it, try the next video");
  expect(onFound).toHaveBeenLastCalledWith(SECOND, 64.7, 67.75);
  expect(() => button("Load it")).toThrow();
});

test("says when a miss leaves the earlier suggestion in the player", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={FIRST} />);
  });
  locateReplies.push(() => missed(SECOND, "not_heard", []));
  await click("Not it, try the next video");
  expect(text()).toContain(
    "The earlier suggestion is still in the quote player."
  );
});

test("moves focus to the status after each press", async () => {
  await mount();
  locateReplies.push(() => new Promise<Response>(() => undefined));
  await click("Find it for me");
  expect(focus).toHaveBeenCalled();
  focus.mockClear();
  await click("Cancel");
  expect(focus).toHaveBeenCalledOnce();
  expect(button("Find it for me")).toBeDefined();
});

test("focus stays where the listener went while a check ran", async () => {
  const body = { getAttribute: () => null };
  const doc = { body, activeElement: body as unknown };
  vi.stubGlobal("document", doc);
  await mount();
  let answer: (response: Response) => void = () => undefined;
  locateReplies.push(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      })
  );
  await click("Find it for me");
  const calls = focus.mock.calls.length;
  expect(calls).toBeGreaterThan(0);
  // The listener tabs to the search box while the check runs.
  doc.activeElement = { getAttribute: () => null };
  await act(async () => answer(found(FIRST, [])));
  expect(focus).toHaveBeenCalledTimes(calls);
});

test("focus that fell to the dialog itself counts as lost", async () => {
  vi.stubGlobal("document", {
    body: { getAttribute: () => null },
    activeElement: { getAttribute: () => "dialog" },
  });
  await mount();
  locateReplies.push(() => found(FIRST, []));
  await click("Find it for me");
  expect(focus).toHaveBeenCalled();
});

test("Try the next video skips a video that timed out", async () => {
  await mount();
  locateReplies.push(() => missed(FIRST, "timeout", [SECOND]));
  await click("Find it for me");
  locateReplies.push(() => missed(SECOND, "not_heard", []));
  await click("Try the next video");
  expect(locateBodies()[1]).toEqual([SECOND]);
});

test("after the listener loads a video by hand, a new suggestion waits for Load it", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND, THIRD]));
  await click("Find it for me");
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={FIRST} />);
  });
  // The listener pastes another video.
  await act(async () => {
    view.update(<Assistant hasClip loadedVideoId={THIRD} />);
  });
  locateReplies.push(() => found(SECOND, []));
  await click("Find it for me");
  expect(onFound).toHaveBeenCalledTimes(1);
  expect(button("Load it")).toBeDefined();
});

test("Not it moves on to videos only a newer search listed", async () => {
  const FOURTH = "ddddddddddd";
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  act(() => search.setQuery("Taxi Driver mirror scene"));
  fetchMock.mockImplementationOnce(async () =>
    json({
      videos: [FIRST, SECOND, FOURTH].map((id) => ({
        ...video(id),
        channel: "Movies",
      })),
      nextPageToken: null,
    })
  );
  await act(async () => {
    await search.search();
  });
  locateReplies.push(() => missed(SECOND, "not_heard", []));
  await click("Not it, try the next video");
  expect(locateBodies()[1]).toEqual([SECOND, FOURTH]);
});

test("Restore from a later step says so and keeps focus on the panel", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  act(() => button("Use exact wording").props.onClick());
  await act(async () => {
    view.update(<Assistant quoteText="You talkin' to me?" />);
  });
  locateReplies.push(() => missed(SECOND, "not_heard", []));
  await click("Not it, try the next video");
  focus.mockClear();
  act(() => button("Restore my wording").props.onClick());
  expect(onUseWording).toHaveBeenLastCalledWith("You talking to me");
  expect(text()).toContain("Your own wording is back in the form.");
  expect(focus).toHaveBeenCalledOnce();
});

test("an unsure match whose words are the listener's own doesn't claim they differ", async () => {
  await mount(<Assistant quoteText="You talkin' to me?" />);
  locateReplies.push(() =>
    json({
      status: "found",
      video: video(FIRST),
      start: 64.7,
      end: 67.75,
      spokenText: "You talkin' to me?",
      match: "possible",
      remaining: [],
    })
  );
  await click("Find it for me");
  expect(text()).toContain("the assistant isn’t sure it’s the line");
  expect(text()).not.toContain("don’t quite match");
  expect(text()).toContain("It matches your quote.");
});

test("while a check runs the row keeps its place, with Cancel last", async () => {
  await mount();
  locateReplies.push(() => new Promise<Response>(() => undefined));
  await click("Find it for me");
  const labels = view.root.findAllByType("button").map((item) => text(item));
  expect(labels.slice(-2)).toEqual(["Find it for me", "Cancel"]);
  expect(button("Find it for me").props.disabled).toBe(true);
});

test("a suggestion whose times the listener changed isn't replaced without asking", async () => {
  await mount();
  locateReplies.push(() => found(FIRST, [SECOND]));
  await click("Find it for me");
  // The form holds the suggestion at its range.
  await act(async () => {
    view.update(
      <Assistant
        hasClip
        loadedVideoId={FIRST}
        clipStart="64.7"
        clipEnd="67.75"
      />
    );
  });
  let answer: (response: Response) => void = () => undefined;
  locateReplies.push(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      })
  );
  await click("Not it, try the next video");
  // While the check runs, the listener trims the range by hand.
  await act(async () => {
    view.update(
      <Assistant hasClip loadedVideoId={FIRST} clipStart="40" clipEnd="45" />
    );
  });
  await act(async () => answer(found(SECOND, [])));
  expect(onFound).toHaveBeenCalledTimes(1);
  expect(button("Load it")).toBeDefined();
});

test("a refusal lifts at its retry time on its own", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    const probe: { access: ReturnType<typeof useAssistantAccess> | null } = {
      access: null,
    };
    function Probe() {
      probe.access = useAssistantAccess();
      return null;
    }
    await act(async () => {
      view = create(<Probe />);
    });
    act(() => probe.access?.disable("Try in a minute.", 60));
    expect(probe.access?.disabledReason).toBe("Try in a minute.");
    act(() => {
      vi.advanceTimersByTime(60_001);
    });
    expect(probe.access?.disabledReason).toBeNull();
    // A refusal with no retry time stays.
    act(() => probe.access?.disable("Out of budget.", null));
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(probe.access?.disabledReason).toBe("Out of budget.");
  } finally {
    vi.useRealTimers();
  }
});

test("a search replaced and then asked for again runs again", async () => {
  await mount();
  fetchMock.mockImplementationOnce(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        )
      )
  );
  let first: Promise<unknown> = Promise.resolve();
  act(() => {
    first = search.search();
  });
  // The listener edits the query and puts it back before the first settles.
  act(() => search.setQuery("Taxi Driver mirror"));
  act(() => search.setQuery("Taxi Driver You talking to me"));
  let second: unknown;
  await act(async () => {
    second = await search.search();
  });
  expect(await first).toBe("replaced");
  expect(second).toHaveLength(3);
  expect(searches()).toHaveLength(2);
});
