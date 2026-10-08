import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: {},
  load: vi.fn(),
  submit: vi.fn(),
  errorCode: vi.fn((): string | null => null),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("@/convex/wagers", () => ({
  loadConvexAssignmentWagers: mocks.load,
  submitConvexWager: mocks.submit,
}));
vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: () => mocks.errorCode(),
}));

import { ConvexAssignmentGamblingBoard } from "@/components/ConvexAssignmentGamblingBoard";

const hosts = ["MCP", "Fonso", "Harley"].map((name) => ({
  id: name.toLowerCase(),
  name,
  image: null,
}));
const rating = {
  id: "r3",
  name: "Dollar",
  value: 3,
  category: null,
  icon: null,
  sound: null,
};
const guesses = hosts.map((host) => ({
  id: `guess-${host.id}`,
  hostId: host.id,
  rating,
}));
const type = (lookupId: string, multiplier: number) => ({
  id: lookupId,
  title: lookupId,
  lookupId,
  description: null,
  multiplier,
  isActive: true,
  createdAt: 0,
});
const types = [
  type("mcp-rating-guess-1x", 1),
  type("fonso-rating-guess-1x", 1),
  type("harley-rating-guess-1x", 1),
  type("mcp-fonso-rating-guess-2x", 2),
  type("mcp-harley-rating-guess-2x", 2),
  type("fonso-harley-rating-guess-2x", 2),
  type("all-rating-guess-3x", 3),
];
const entry = (
  lookupId: string,
  points: number,
  targetHostId: string | null = null,
  status = "pending"
) => ({
  id: `${lookupId}-entry`,
  points,
  status,
  gamblingType: types.find((candidate) => candidate.lookupId === lookupId),
  targetUser:
    targetHostId === null
      ? null
      : { id: targetHostId, name: targetHostId, image: null },
});
const allThree = entry("all-rating-guess-3x", 25);
const oneHost = entry("mcp-rating-guess-1x", 10, "mcp");

let renderer: ReactTestRenderer;
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object" && "children" in node)
    return text(node.children);
  return "";
}
const screenText = () => text(renderer.toJSON());
const buttons = () => renderer.root.findAllByType("button");
function button(label: string) {
  const found = buttons().find(
    (node) => node.props["aria-label"] === label || text(node).trim() === label
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => {
    await button(label).props.onClick();
  });
}
async function renderBoard(entries: unknown[], episodeStatus = "next") {
  mocks.load.mockResolvedValue({ types, entries, availablePoints: 140 });
  await act(async () => {
    renderer = create(
      <ConvexAssignmentGamblingBoard
        assignmentId="assignment"
        hosts={hosts}
        guesses={guesses}
        episodeStatus={episodeStatus}
        playable
        closesAt={null}
        now={0}
      />
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

test("the wager line sums up what is at stake without opening the list", async () => {
  await renderBoard([]);
  expect(screenText()).toContain("Optional. None placed yet.");
  expect(button("Add a wager").props["aria-expanded"]).toBe(false);
  expect(renderer.root.findAllByType("h4")).toHaveLength(0);
  act(() => renderer.unmount());

  await renderBoard([allThree]);
  expect(screenText()).toContain("25 pts on all three hosts");
  expect(screenText()).toContain("+75 if they all match");
  act(() => renderer.unmount());

  await renderBoard([allThree, oneHost]);
  expect(screenText()).toContain("35 pts on 2 bets");
  expect(screenText()).toContain("up to +85");
  expect(text(button("Change"))).toBe("Change");
});

test("the list offers every bet and edits one at a time", async () => {
  await renderBoard([oneHost]);
  await click("Change");
  expect(screenText()).toContain("140 pts available");
  expect(renderer.root.findAllByType("h4").map(text)).toEqual([
    "One host1x",
    "Two hosts2x",
    "All three3x",
  ]);
  expect(button("Edit wager on MCP")).toBeDefined();
  expect(screenText()).toContain("10 pts · wins +10");
  expect(buttons().filter((node) => text(node).trim() === "Add")).toHaveLength(
    6
  );

  await click("Add wager on MCP + Fonso");
  expect(renderer.root.findAllByType("form")).toHaveLength(1);
  await click("Add wager on MCP + Fonso + Harley");
  expect(renderer.root.findAllByType("form")).toHaveLength(1);
  expect(button("Add wager on MCP + Fonso")).toBeDefined();

  await click("Done");
  expect(renderer.root.findAllByType("form")).toHaveLength(0);
  expect(screenText()).toContain("10 pts on MCP");
  expect(screenText()).toContain("+10 if it matches");
});

test("confirming a bet saves it for its hosts and reloads the board", async () => {
  mocks.submit.mockResolvedValue(undefined);
  await renderBoard([]);
  await click("Add a wager");
  await click("Add wager on Fonso");
  act(() =>
    renderer.root
      .findByType("input")
      .props.onChange({ target: { value: "20" } })
  );
  mocks.load.mockResolvedValue({
    types,
    entries: [entry("fonso-rating-guess-1x", 20, "fonso")],
    availablePoints: 120,
  });
  await act(async () => {
    await renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(mocks.submit).toHaveBeenCalledWith(mocks.convex, {
    gamblingTypeId: "fonso-rating-guess-1x",
    points: 20,
    assignmentId: "assignment",
    targetUserId: "fonso",
  });
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(renderer.root.findAllByType("form")).toHaveLength(0);
  expect(screenText()).toContain("120 pts available");
  expect(button("Edit wager on Fonso")).toBeDefined();
});

test("a failed load says wagers are unchanged and Try again brings the board back", async () => {
  mocks.load.mockRejectedValueOnce(new Error("offline"));
  await renderBoard([oneHost]);
  expect(text(renderer.root.findByProps({ role: "alert" }))).toContain(
    "Couldn’t load wagering. Your wagers were not changed."
  );
  expect(buttons().map((node) => text(node).trim())).toEqual(["Try again"]);

  await click("Try again");
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(screenText()).toContain("10 pts on MCP");
  expect(text(button("Change"))).toBe("Change");
});

test("a wager the backend refuses stays open with the reason while the board reloads", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("refused"));
  mocks.errorCode.mockReturnValueOnce("CONFLICT");
  await renderBoard([]);
  await click("Add a wager");
  await click("Add wager on Fonso");
  act(() =>
    renderer.root
      .findByType("input")
      .props.onChange({ target: { value: "20" } })
  );
  // Another tab spent points before this wager reached the backend.
  mocks.load.mockResolvedValue({ types, entries: [], availablePoints: 15 });
  await act(async () => {
    await renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(mocks.load).toHaveBeenCalledTimes(3);
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe(
    "Betting closed or your available point balance changed. Review the latest state and retry."
  );
  expect(renderer.root.findAllByType("form")).toHaveLength(1);
  expect(screenText()).toContain("15 pts available");
  expect(button("Max 15")).toBeDefined();
  expect(screenText()).not.toContain("Miss and you lose");
});

test("opening the list reloads the balance another movie's wager may have changed", async () => {
  await renderBoard([]);
  mocks.load.mockResolvedValue({ types, entries: [], availablePoints: 90 });
  await click("Add a wager");
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(screenText()).toContain("90 pts available");
});

test("while one bet saves, the other bets and Done wait for its result", async () => {
  let finish!: () => void;
  mocks.submit.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  await renderBoard([oneHost]);
  await click("Change");
  await click("Add wager on Fonso");
  act(() =>
    renderer.root
      .findByType("input")
      .props.onChange({ target: { value: "20" } })
  );
  await act(async () => {
    void renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() });
  });
  expect(button("Done").props.disabled).toBe(true);
  expect(button("Edit wager on MCP").props.disabled).toBe(true);
  expect(button("Add wager on Harley").props.disabled).toBe(true);

  await act(async () => {
    finish();
  });
  expect(renderer.root.findAllByType("form")).toHaveLength(0);
  expect(button("Done").props.disabled).toBe(false);
  expect(button("Add wager on Harley").props.disabled).toBe(false);
});

test("focus stays with the list's toggle and returns to a bet's own line", async () => {
  const focused: string[] = [];
  mocks.load.mockResolvedValue({
    types,
    entries: [oneHost],
    availablePoints: 140,
  });
  await act(async () => {
    renderer = create(
      <ConvexAssignmentGamblingBoard
        assignmentId="assignment"
        hosts={hosts}
        guesses={guesses}
        episodeStatus="next"
        playable
        closesAt={null}
        now={0}
      />,
      {
        createNodeMock: (element) => ({
          focus: () =>
            focused.push(
              String(
                element.props["aria-label"] ??
                  (element.props["aria-expanded"] === true ? "Done" : "toggle")
              )
            ),
        }),
      }
    );
  });
  expect(focused).toEqual([]);
  await click("Change");
  expect(focused).toEqual(["Done"]);
  await click("Add wager on Fonso");
  await click("Cancel");
  expect(focused).toEqual(["Done", "Add wager on Fonso"]);
  await click("Done");
  expect(focused).toEqual(["Done", "Add wager on Fonso", "toggle"]);
});

test("a rejected wager is not counted as points at stake", async () => {
  await renderBoard([
    entry("all-rating-guess-3x", 25, null, "rejected"),
    oneHost,
  ]);
  expect(screenText()).toContain("10 pts on MCP");
  expect(screenText()).not.toContain("35 pts");
  act(() => renderer.unmount());

  await renderBoard([entry("all-rating-guess-3x", 25, null, "rejected")]);
  expect(screenText()).toContain("None at stake.");
  await click("Change");
  expect(screenText()).toContain("Wager rejected");
});

test("a locked round lists each wager and offers nothing to change", async () => {
  await renderBoard(
    [
      entry("all-rating-guess-3x", 25, null, "locked"),
      entry("mcp-rating-guess-1x", 10, "mcp", "won"),
    ],
    "published"
  );
  expect(renderer.root.findAllByType("li").map(text)).toEqual([
    "10 pts on MCP1xwon",
    "25 pts on all three hosts3xlocked",
  ]);
  expect(buttons()).toHaveLength(0);
  act(() => renderer.unmount());

  await renderBoard([], "published");
  expect(screenText()).toContain("No wagers");
  expect(buttons()).toHaveLength(0);
});
