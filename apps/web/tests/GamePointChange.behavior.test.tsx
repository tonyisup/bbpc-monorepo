import {
  act,
  create,
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
  useQuery: vi.fn<(reference: unknown, args: { today: string }) => unknown>(),
}));

vi.mock("convex/react", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: { games: { member: { myLatestPointChange: "myLatestPointChange" } } },
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import { useUnseenPointChange } from "@/components/GamePointChange";
import { summarizeLatestPointChange } from "@/convex/pointChange";

const HOUR = 60 * 60 * 1000;
// 9pm Pacific on Sep 10, which is already Sep 11 in UTC.
const LATEST = Date.parse("2026-09-11T04:00:00Z");

function result(points: Array<[number, number]>) {
  return {
    seasonId: "season-1",
    lastScoredAt: LATEST,
    points: points.map(([earnedAt, pointValue]) => ({ earnedAt, pointValue })),
  };
}

let renderer: ReactTestRenderer | null = null;
let storage: Map<string, string>;
let latestChange: number | null | undefined;

function Harness({
  enabled,
  onGamePage,
}: {
  enabled: boolean;
  onGamePage: boolean;
}) {
  const { change, loader } = useUnseenPointChange(enabled, onGamePage);
  latestChange = change;
  return <>{loader}</>;
}

function render(props: { enabled: boolean; onGamePage: boolean }) {
  act(() => {
    if (renderer === null) {
      renderer = create(<Harness {...props} />);
    } else {
      renderer.update(<Harness {...props} />);
    }
  });
  return latestChange;
}

describe("summarizeLatestPointChange", () => {
  test("sums the member's points from the latest point's Pacific day", () => {
    expect(
      summarizeLatestPointChange(
        result([
          [LATEST - 7 * 24 * HOUR, 4],
          // 7am Pacific on Sep 10.
          [LATEST - 14 * HOUR, 5],
          [LATEST - HOUR, -2],
        ])
      )
    ).toEqual({ key: "season-1:2026-09-10:3", change: 3 });
  });

  test("ignores empty and malformed responses", () => {
    expect(summarizeLatestPointChange(null)).toBeNull();
    expect(summarizeLatestPointChange({ seasonId: "season-1" })).toBeNull();
  });
});

describe("useUnseenPointChange", () => {
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    mocks.useQuery.mockReturnValue(result([[LATEST, 5]]));
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    latestChange = undefined;
    mocks.useQuery.mockReset();
    vi.unstubAllGlobals();
  });

  test("shows the change until the game page is visited", () => {
    expect(render({ enabled: true, onGamePage: false })).toBe(5);
    expect(mocks.useQuery).toHaveBeenCalledWith("myLatestPointChange", {
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    });

    expect(render({ enabled: true, onGamePage: true })).toBeNull();
    expect(storage.get("bbpc.seenPointChange")).toBe("season-1:2026-09-10:5");
    expect(render({ enabled: true, onGamePage: false })).toBeNull();

    mocks.useQuery.mockReturnValue(result([[LATEST, 5], [LATEST, 2]]));
    expect(render({ enabled: true, onGamePage: false })).toBe(7);
  });

  test("stays hidden for signed-out visitors and zero changes", () => {
    expect(render({ enabled: false, onGamePage: false })).toBeNull();
    expect(mocks.useQuery).not.toHaveBeenCalled();

    mocks.useQuery.mockReturnValue(result([]));
    expect(render({ enabled: true, onGamePage: false })).toBeNull();
  });
});
