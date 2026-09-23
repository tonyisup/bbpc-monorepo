import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn<(reference: unknown, args: { now: number }) => unknown>(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: { announcements: { public: { listLive: "listLive" } } },
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => {
  const Icon = () => <svg />;
  return { AlertTriangle: Icon, Info: Icon, X: Icon };
});

import { ConvexSiteAnnouncements } from "@/components/ConvexSiteAnnouncements";

const NOW = Date.parse("2026-09-23T18:00:30Z");
const MINUTE = 60 * 1000;
const STORAGE_KEY = "bbpc.dismissedAnnouncements";

function announcement(
  overrides: Partial<{
    id: string;
    message: string;
    severity: "info" | "warning";
    endsAt: number;
    linkUrl: string | null;
    linkLabel: string | null;
    dismissible: boolean;
    updatedAt: number;
  }> = {},
) {
  return {
    id: "announcement-1",
    message: "No episode this week.",
    severity: "info" as const,
    startsAt: NOW - MINUTE,
    endsAt: NOW + 60 * MINUTE,
    linkUrl: null,
    linkLabel: null,
    dismissible: true,
    updatedAt: 1,
    ...overrides,
  };
}

let renderer: ReactTestRenderer | null = null;
let storage: Map<string, string>;

function render() {
  act(() => {
    renderer = create(<ConvexSiteAnnouncements />);
  });
  if (renderer === null) {
    throw new Error("Announcements did not render.");
  }
  return renderer;
}

function banners(rendered: ReactTestRenderer): ReactTestInstance[] {
  return rendered.root.findAllByType("section");
}

function text(instance: ReactTestInstance): string {
  return JSON.stringify(instance.children.map((child) =>
    typeof child === "string" ? child : text(child),
  ));
}

describe("ConvexSiteAnnouncements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    storage = new Map();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", { origin: "https://badboyspodcast.com" });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("renders nothing while loading and queries at minute precision", () => {
    mocks.useQuery.mockReturnValue(undefined);
    const rendered = render();

    expect(rendered.toJSON()).toBeNull();
    expect(mocks.useQuery).toHaveBeenLastCalledWith("listLive", {
      now: Date.parse("2026-09-23T18:00:00Z"),
    });

    act(() => {
      vi.advanceTimersByTime(30 * 1000);
    });
    expect(mocks.useQuery).toHaveBeenLastCalledWith("listLive", {
      now: Date.parse("2026-09-23T18:01:00Z"),
    });
  });

  test("renders each live announcement with its severity and link", () => {
    mocks.useQuery.mockReturnValue([
      announcement({
        id: "warning",
        message: "Site maintenance tonight.",
        severity: "warning",
        linkUrl: "https://status.example.test",
        linkLabel: "Status",
        dismissible: false,
      }),
      announcement({
        id: "info",
        linkUrl: "https://badboyspodcast.com/episodes",
      }),
    ]);
    const rendered = render();
    const [warning, info] = banners(rendered);

    expect(warning?.props).toMatchObject({
      "aria-label": "Site warning",
      role: "alert",
    });
    expect(text(warning!)).toContain("Site maintenance tonight.");
    expect(warning?.findByType("a").props).toMatchObject({
      href: "https://status.example.test",
      rel: "noopener noreferrer",
      target: "_blank",
      children: "Status",
    });
    expect(warning?.findAllByType("button")).toHaveLength(0);

    expect(info?.props).toMatchObject({ role: "status" });
    const internalLink = info?.findByType("a");
    expect(internalLink?.props.target).toBeUndefined();
    expect(internalLink?.props.children).toBe("Learn more");
  });

  test("remembers dismissals until the announcement is edited", () => {
    storage.set(STORAGE_KEY, JSON.stringify({ stale: 1 }));
    mocks.useQuery.mockReturnValue([announcement()]);
    const rendered = render();

    act(() => {
      rendered.root
        .findByProps({ "aria-label": "Dismiss announcement" })
        .props.onClick();
    });
    expect(rendered.toJSON()).toBeNull();
    expect(JSON.parse(storage.get(STORAGE_KEY) ?? "")).toEqual({
      "announcement-1": 1,
    });

    act(() => renderer?.unmount());
    renderer = null;
    expect(render().toJSON()).toBeNull();

    mocks.useQuery.mockReturnValue([announcement({ updatedAt: 2 })]);
    act(() => renderer?.update(<ConvexSiteAnnouncements />));
    expect(banners(renderer!)).toHaveLength(1);
  });

  test("ignores unreadable storage", () => {
    storage.set(STORAGE_KEY, "not json");
    mocks.useQuery.mockReturnValue([announcement()]);
    expect(banners(render())).toHaveLength(1);
  });

  test("hides announcements that ended within the current minute", () => {
    mocks.useQuery.mockReturnValue([announcement({ endsAt: NOW })]);
    expect(render().toJSON()).toBeNull();
  });

  test("renders nothing when the query fails", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.useQuery.mockImplementation(() => {
      throw new Error("Could not find public function");
    });
    expect(render().toJSON()).toBeNull();
    consoleError.mockRestore();
  });
});
