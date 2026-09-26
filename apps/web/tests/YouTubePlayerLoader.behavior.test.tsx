import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const SRC = "https://www.youtube.com/iframe_api";

class FakeScript {
  src = "";
  async = false;
  listeners = new Set<() => void>();
  remove = vi.fn(() => {
    head.splice(head.indexOf(this), 1);
  });
  addEventListener(_type: string, listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: () => void) {
    this.listeners.delete(listener);
  }
  fail() {
    this.listeners.forEach((listener) => listener());
  }
}

let head: FakeScript[];
let widgetScript: { remove: () => void } | null = null;
let win: { YT?: unknown } & Record<string, unknown>;

async function freshLoader() {
  vi.resetModules();
  return (await import("@/lib/youtubePlayer")).loadYouTubeAPI;
}

describe("YouTube iframe API loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    head = [];
    win = {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: number) => clearInterval(id),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      querySelector: () => head.find((script) => script.src === SRC) ?? null,
      getElementById: (id: string) =>
        id === "www-widgetapi-script" ? widgetScript : null,
      createElement: () => new FakeScript(),
      head: { appendChild: (script: FakeScript) => head.push(script) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("shares one script request between players and resolves once the API is ready", async () => {
    const load = await freshLoader();
    const first = load();
    const second = load();
    expect(second).toBe(first);
    expect(head).toHaveLength(1);
    expect(head[0]).toMatchObject({ src: SRC, async: true });

    const api = { Player: class {} };
    win.YT = api;
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(api);
    expect(vi.getTimerCount()).toBe(0);
    // Once loaded, later players skip the script entirely.
    await expect(load()).resolves.toBe(api);
    expect(head).toHaveLength(1);
  });

  test("a failed or stalled load rejects, cleans up its own tag, and can be retried", async () => {
    const load = await freshLoader();
    const failed = load();
    const script = head[0]!;
    script.fail();
    await expect(failed).rejects.toThrow("YouTube could not load");
    expect(script.remove).toHaveBeenCalledOnce();
    expect(head).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    const stalled = load();
    expect(stalled).not.toBe(failed);
    expect(head).toHaveLength(1);
    const assertion = expect(stalled).rejects.toThrow("YouTube could not load");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(head).toHaveLength(0);

    // A tag another player added is reused and left in place on failure.
    const shared = new FakeScript();
    shared.src = SRC;
    head.push(shared);
    const reused = load();
    expect(head).toEqual([shared]);
    shared.fail();
    await expect(reused).rejects.toThrow();
    expect(shared.remove).not.toHaveBeenCalled();
  });

  test("recovers when iframe_api loads but its widget script never arrives", async () => {
    const load = await freshLoader();
    const first = load();
    // iframe_api declares `var YT`: a writable but non-deletable global.
    Object.defineProperty(win, "YT", {
      value: { loading: 1 },
      writable: true,
      configurable: false,
    });
    widgetScript = { remove: vi.fn() };
    vi.advanceTimersByTime(15_000);
    await expect(first).rejects.toThrow("YouTube could not load");
    expect(win.YT).toBeUndefined();
    expect(widgetScript.remove).toHaveBeenCalledOnce();
    widgetScript = null;

    const retry = load();
    expect(retry).not.toBe(first);
    expect(head).toHaveLength(1);
    win.YT = { Player: class {} };
    vi.advanceTimersByTime(100);
    await expect(retry).resolves.toBe(win.YT);
  });
});
