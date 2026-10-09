import React, { useEffect, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: { query: vi.fn().mockResolvedValue([]) },
  loadPicks: vi.fn(),
  savePick: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  saveNotes: vi.fn(),
  liveWindow: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
  useQuery: () => mocks.liveWindow(),
}));
vi.mock("@/convex/predictions", () => ({
  loadConvexPredictionData: mocks.loadPicks,
  submitConvexPrediction: mocks.savePick,
}));
vi.mock("@/convex/syllabus", () => ({
  listConvexSyllabus: mocks.list,
  searchConvexCatalogMovies: mocks.search,
  searchConvexTmdbMovies: async () => [],
  addConvexSyllabusEntry: mocks.add,
  removeConvexSyllabusEntry: mocks.remove,
  updateConvexSyllabusNotes: mocks.saveNotes,
  reorderConvexSyllabus: vi.fn(),
  upsertConvexTmdbMovie: vi.fn(),
}));
vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: () => null,
  BBPC_CLIENT_API_VERSION: "test",
}));
vi.mock("@/components/MovieInlinePreview", () => ({ default: () => <span /> }));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("@/components/ConvexAssignmentGamblingBoard", () => ({
  ConvexAssignmentGamblingBoard: () => <button>Set wager</button>,
}));
vi.mock("@/utils/uploadthing", () => ({ useUploadThing: () => ({}) }));
vi.mock("@/hooks/useAudioRecorder", () => ({
  useAudioRecorder: () => {
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    return {
      audioBlob,
      recordingTime: 3,
      isRecording: false,
      isPlaying: false,
      startRecording: () => setAudioBlob(new Blob(["test"])),
      stopRecording: vi.fn(),
      stopPlayback: vi.fn(),
      resetRecording: () => setAudioBlob(null),
    };
  },
}));
vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: Container,
    DialogHeader: Container,
    DialogFooter: Container,
    DialogTitle: Container,
    DialogDescription: Container,
  };
});

import { ConvexSyllabusManager } from "@/app/syllabus/ConvexSyllabusManager";
import { ConvexPredictionGame } from "@/components/ConvexPredictionGame";
import BettingCoin from "@/components/BettingCoin";

const movie = (id: string) => ({
  id,
  title: `Movie ${id}`,
  year: 2000,
  poster: null,
  tmdbId: null,
  url: "https://example.test",
});
const entries = ["a", "b"].map((id, order) => ({
  id,
  order,
  createdAt: 0,
  movie: movie(id),
  notes: null,
  assignment: null,
}));
const ratings = [1, 2].map((value) => ({
  id: `r${value}`,
  name: `Rating ${value}`,
  value,
  category: null,
  icon: null,
  sound: null,
}));
const initialPicks = {
  activeSeason: true,
  hosts: [{ id: "host", name: "Host One", image: null }],
  ratings,
  scoring: { correctHost: 1, allCorrectBonus: 2, allIncorrect: -1 },
  guessesByAssignment: {},
};
let renderer: ReactTestRenderer;
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object" && "children" in node)
    return text(node.children);
  return "";
}
const screenText = () => text(renderer.toJSON());
function button(label: string) {
  const found = renderer.root
    .findAllByType("button")
    .find(
      (node) =>
        node.props["aria-label"] === label || text(node).trim() === label
    );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => {
    await button(label).props.onClick({ currentTarget: { focus: vi.fn() } });
  });
}
async function render(ui: React.ReactElement) {
  await act(async () => {
    renderer = create(ui, {
      createNodeMock: () => ({ focus: vi.fn(), scrollIntoView: vi.fn() }),
    });
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function renderPicks() {
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "assignment",
          playable: true,
          movie: { title: "Test movie", poster: null },
        },
      ]}
      episodeStatus="next"
    />
  );
}
const movieText = () => renderer.root.findAllByType("article").map(text);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  mocks.liveWindow.mockReturnValue(undefined);
  mocks.list.mockResolvedValue(entries);
  mocks.search.mockResolvedValue([movie("c")]);
  mocks.loadPicks.mockResolvedValue(initialPicks);
  mocks.remove.mockResolvedValue(undefined);
  mocks.add.mockResolvedValue(undefined);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderWager(
  submit: () => Promise<void>,
  close = vi.fn(),
  overrides: {
    existingBet?: { points: number; status: string };
    userPoints?: number;
    isEditing?: boolean;
  } = {}
) {
  await render(
    <BettingCoin
      type={{ id: "type", multiplier: 1.5 }}
      label="Host One"
      name="Host One"
      existingBet={overrides.existingBet}
      assignmentId="assignment"
      userPoints={overrides.userPoints ?? 100}
      isEditing={overrides.isEditing ?? true}
      onEdit={vi.fn()}
      onClose={close}
      onSubmit={submit}
    />
  );
  return close;
}
const typeWager = (value: string) =>
  act(() =>
    renderer.root.findByType("input").props.onChange({ target: { value } })
  );
const confirmWager = () =>
  act(async () => {
    await renderer.root
      .findByType("form")
      .props.onSubmit({ preventDefault: vi.fn() });
  });

test("a wager states its exact whole-point loss and win before it is confirmed", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const close = await renderWager(submit);
  typeWager("3");
  expect(screenText()).toContain(
    "Miss and you lose 3. Hit and you win +4, with your 3 back."
  );
  // Every movie lists the same bets, so the movie keeps their ids apart.
  const input = renderer.root.findByType("input");
  expect(input.props.id).toBe("wager-assignment-type-all");
  expect(input.props["aria-describedby"]).toBe(
    "wager-assignment-type-all-outcome"
  );
  expect(button("Confirm 3 pts").props["aria-disabled"]).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  await confirmWager();
  expect(submit).toHaveBeenCalledWith({
    gamblingTypeId: "type",
    points: 3,
    assignmentId: "assignment",
    targetUserId: undefined,
  });
  expect(close).toHaveBeenCalledTimes(1);
});

test("a wager above the listener's points is refused without a request", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const close = await renderWager(submit);
  typeWager("101");
  expect(screenText()).not.toContain("Miss and you lose");
  await confirmWager();
  expect(screenText()).toContain(
    "You can wager up to 100 points on this outcome."
  );
  await click("Max 100");
  expect(screenText()).toContain(
    "Miss and you lose 100. Hit and you win +150, with your 100 back."
  );
  expect(submit).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test("a wager that fails to save stays open with its reason and cannot be sent twice", async () => {
  const request = deferred<void>();
  const submit = vi
    .fn<() => Promise<void>>()
    .mockReturnValueOnce(request.promise)
    .mockRejectedValueOnce(new Error(""));
  const close = await renderWager(submit);
  typeWager("5");
  await confirmWager();
  // The control that held focus when the save began stays focusable.
  expect(button("Saving…").props["aria-disabled"]).toBe(true);
  expect(button("Saving…").props.disabled).toBeUndefined();
  expect(renderer.root.findByType("input").props.readOnly).toBe(true);
  expect(renderer.root.findByType("input").props.disabled).toBeUndefined();
  expect(button("Cancel").props.disabled).toBe(true);
  expect(button("Max 100").props.disabled).toBe(true);
  await confirmWager();
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => {
    request.reject(new Error("ROUND_LOCKED"));
  });
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe(
    "Betting closed before this wager could be saved."
  );
  expect(button("Confirm 5 pts").props["aria-disabled"]).toBe(false);
  expect(renderer.root.findByType("input").props.readOnly).toBe(false);
  await confirmWager();
  expect(text(renderer.root.findByProps({ role: "alert" }))).toBe(
    "Couldn’t save this wager. Check your connection and retry."
  );
  expect(submit).toHaveBeenCalledTimes(2);
  expect(close).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType("form")).toHaveLength(1);
});

test("an existing wager opens at its stake, clears to zero and is read-only once settled", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const close = await renderWager(submit, vi.fn(), {
    existingBet: { points: 20, status: "pending" },
  });
  expect(renderer.root.findByType("input").props.value).toBe("20");
  expect(screenText()).toContain(
    "Miss and you lose 20. Hit and you win +30, with your 20 back."
  );
  // The stake already placed counts toward what can be risked.
  expect(button("Max 120")).toBeDefined();
  await click("Clear wager");
  expect(submit).toHaveBeenCalledWith({
    gamblingTypeId: "type",
    points: 0,
    assignmentId: "assignment",
    targetUserId: undefined,
  });
  expect(close).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());

  await renderWager(submit, vi.fn(), {
    existingBet: { points: 20, status: "won" },
    isEditing: false,
  });
  // A settled bet no longer promises a win.
  expect(screenText()).toContain("20 pts");
  expect(screenText()).not.toContain("wins +");
  expect(screenText()).toContain("Wager won");
  expect(renderer.root.findAllByType("button")).toHaveLength(0);
});

test("a wager must be a whole number above zero, and the quick amounts stay within the listener's points", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const close = await renderWager(submit, vi.fn(), { userPoints: 20 });
  expect(
    renderer.root
      .findByType("form")
      .findAllByType("button")
      .map((node) => text(node).trim())
  ).toEqual(["10", "Max 20", "Confirm wager", "Cancel"]);
  expect(screenText()).toContain("You can risk up to 20 points on this bet.");
  for (const amount of ["", "0", "2.5", "-3"]) {
    typeWager(amount);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await confirmWager();
    expect(text(renderer.root.findByProps({ role: "alert" }))).toBe(
      "Enter a whole number greater than zero."
    );
  }
  await click("10");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(renderer.root.findByType("input").props.value).toBe("10");
  expect(button("Confirm 10 pts")).toBeDefined();
  expect(submit).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test("the game sheet keeps its other rows mounted while picks load, fail and recover", async () => {
  let rowMounts = 0;
  const QuoteRow = () => {
    useEffect(() => {
      rowMounts += 1;
    }, []);
    return <p>Quote row</p>;
  };
  const game = (
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "assignment",
          playable: true,
          movie: { title: "Test movie", poster: null },
        },
      ]}
      episodeStatus="next"
    >
      <QuoteRow />
    </ConvexPredictionGame>
  );
  const firstLoad = deferred<unknown>();
  mocks.loadPicks.mockReturnValueOnce(firstLoad.promise);
  await render(game);
  expect(
    renderer.root.findAllByProps({ "aria-label": "Loading saved picks" })
  ).not.toHaveLength(0);
  expect(screenText()).toContain("Quote row");

  await act(async () => {
    firstLoad.reject(new Error("offline"));
  });
  expect(screenText()).toContain("Check your connection and retry.");
  expect(screenText()).toContain("Quote row");
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(0);

  await click("Try again");
  expect(mocks.loadPicks).toHaveBeenCalledTimes(2);
  expect(screenText()).not.toContain("Check your connection and retry.");
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(1);
  expect(screenText()).toContain("Quote row");
  expect(rowMounts).toBe(1);
  // The scoring rules follow the picks, with signed points.
  expect(renderer.root.findAllByType("dd").map(text)).toEqual([
    "+1",
    "+2",
    "−1",
  ]);
});

test("pending and failed picks never announce completion or unlock wagering", async () => {
  const request = deferred<unknown>();
  mocks.savePick.mockReturnValueOnce(request.promise);
  await renderPicks();
  await act(async () => {
    renderer.root.findAllByType("input")[0]!.props.onChange();
  });
  expect(screenText()).toContain("0 of 1 picks saved");
  expect(screenText()).not.toContain("All picks complete");
  expect(screenText()).not.toContain("Set wager");
  expect(renderer.root.findAllByType("input")[0]!.props.checked).toBe(true);
  await act(async () => {
    request.reject(new Error("offline"));
  });
  expect(screenText()).toContain("0 of 1 picks saved");
  expect(renderer.root.findAllByType("input")[0]!.props.checked).toBe(false);
  mocks.savePick.mockResolvedValueOnce({
    id: "guess",
    hostId: "host",
    rating: ratings[0],
  });
  await click("Retry save");
  expect(screenText()).toContain("1 of 1 picks saved");
  expect(screenText()).toContain("All picks complete");
  expect(screenText()).toContain("Set wager");
});

test("an edit in flight clears the completion claim and disables existing wagering", async () => {
  mocks.loadPicks.mockResolvedValueOnce({
    ...initialPicks,
    guessesByAssignment: {
      assignment: [{ id: "guess", hostId: "host", rating: ratings[0] }],
    },
  });
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[{ id: "assignment", playable: true, movie: null }]}
      episodeStatus="next"
    />
  );
  const request = deferred<unknown>();
  mocks.savePick.mockReturnValueOnce(request.promise);
  await act(async () => {
    renderer.root.findAllByType("input")[1]!.props.onChange();
  });
  expect(screenText()).not.toContain("All picks complete");
  expect(
    renderer.root.findByProps({ "aria-label": "Wager options" }).props.disabled
  ).toBe(true);
  await act(async () => {
    request.reject(new Error("offline"));
  });
  expect(renderer.root.findAllByType("input")[0]!.props.checked).toBe(true);
});

test("rating controls belong to a named host fieldset", async () => {
  await renderPicks();
  const group = renderer.root.findAllByType("fieldset")[0]!;
  expect(group.children[0]).toHaveProperty("type", "legend");
  expect(text(group.children[0])).toBe("Host One");
});

test("voice drafts and accessible actions survive closing and reopening the voice message", async () => {
  await renderPicks();
  const toggle = () => button("Voice message for Test movie");
  expect(toggle().props["aria-expanded"]).toBe(false);
  await click("Voice message for Test movie");
  await click("Record voice message");
  expect(screenText()).toContain("Ready to send");
  await click("Voice message for Test movie");
  expect(toggle().props["aria-expanded"]).toBe(false);
  await click("Voice message for Test movie");
  expect(toggle().props["aria-expanded"]).toBe(true);
  expect(screenText()).toContain("Ready to send");
  expect(button("Send voice message").props["aria-label"]).toBe(
    "Send voice message"
  );
  expect(button("Preview recording").props["aria-label"]).toBe(
    "Preview recording"
  );
  expect(button("Discard recording").props["aria-label"]).toBe(
    "Discard recording"
  );
});

test("a failed movie addition retains the result and insertion choice for retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.add.mockRejectedValueOnce(new Error("offline"));
  await render(<ConvexSyllabusManager appUserId="user" />);
  await click("Add movie");
  act(() => {
    renderer.root
      .findByProps({ id: "convex-movie-search" })
      .props.onChange({ target: { value: "Movie c" } });
    renderer.root
      .findByType("select")
      .props.onChange({ target: { value: "TOP" } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await click("Add");
  expect(button("Add").props.disabled).toBe(false);
  expect(
    renderer.root.findByProps({ id: "convex-movie-search" }).props.value
  ).toBe("Movie c");
  await click("Add");
  expect(mocks.add).toHaveBeenLastCalledWith(mocks.convex, "c", "TOP");
});

test("switching note editors preserves drafts, and cancel discards only the current draft", async () => {
  await render(<ConvexSyllabusManager appUserId="user" />);
  await click("Edit notes Movie a");
  act(() =>
    renderer.root
      .findByType("textarea")
      .props.onChange({ target: { value: "Keep my draft" } })
  );
  await click("Edit notes Movie b");
  act(() =>
    renderer.root
      .findByType("textarea")
      .props.onChange({ target: { value: "Cancel this" } })
  );
  await click("Cancel");
  await click("Edit notes Movie a");
  expect(renderer.root.findByType("textarea").props.value).toBe(
    "Keep my draft"
  );
  expect(renderer.root.findByType("textarea").props["aria-label"]).toBe(
    "Notes for Movie a"
  );
  mocks.saveNotes.mockResolvedValueOnce({
    ...entries[0],
    notes: "Keep my draft",
  });
  await click("Save");
  expect(mocks.saveNotes).toHaveBeenCalledWith(
    mocks.convex,
    "a",
    "Keep my draft"
  );
  await click("Edit notes Movie b");
  expect(renderer.root.findByType("textarea").props.value).toBe("");
});

test("queue filtering uses an unsaved notes draft", async () => {
  await render(<ConvexSyllabusManager appUserId="user" />);
  await click("Edit notes Movie a");
  act(() =>
    renderer.root
      .findByType("textarea")
      .props.onChange({ target: { value: "Draft note" } })
  );
  await click("Edit notes Movie b");
  act(() =>
    renderer.root
      .findByProps({ "aria-label": "Filter your queue" })
      .props.onChange({ target: { value: "draft" } })
  );
  expect(renderer.root.findAllByType("h3").map(text)).toEqual(["Movie a"]);
});

test("only a failed syllabus load offers a retry", async () => {
  mocks.list.mockRejectedValueOnce(new Error("offline"));
  await render(<ConvexSyllabusManager appUserId="user" />);
  expect(screenText()).toContain("Your syllabus could not be loaded.");
  expect(button("Retry loading").props.disabled).toBe(false);

  mocks.list.mockResolvedValueOnce([]);
  await click("Retry loading");
  expect(mocks.list).toHaveBeenCalledTimes(2);
  expect(screenText()).not.toContain("Retry loading");
});

test("a failed syllabus write does not offer a loading retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mocks.list.mockResolvedValueOnce([]);
  mocks.add.mockRejectedValueOnce(new Error("offline"));
  await render(<ConvexSyllabusManager appUserId="user" />);
  await click("Add movie");
  act(() => {
    renderer.root
      .findByProps({ id: "convex-movie-search" })
      .props.onChange({ target: { value: "Movie c" } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await click("Add");
  expect(screenText()).toContain("The syllabus change could not be saved.");
  expect(screenText()).not.toContain("Retry loading");
});

test("removal requires confirmation and preserves the entry after a failed delete", async () => {
  mocks.remove.mockRejectedValueOnce(new Error("offline"));
  await render(<ConvexSyllabusManager appUserId="user" />);
  await click("Remove movie Movie a");
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(screenText()).toContain("Movie a");
  await click("Keep movie");
  expect(mocks.remove).not.toHaveBeenCalled();
  await click("Remove movie Movie a");
  await click("Remove movie");
  expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
  expect(screenText()).toContain("could not be saved");
  await click("Remove movie");
  expect(renderer.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  expect(renderer.root.findAllByType("h3").map(text)).not.toContain("Movie a");
});

test("every movie's picks are open at once and each movie reports its own progress", async () => {
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "first",
          playable: true,
          movie: { title: "First movie", poster: null },
        },
        {
          id: "second",
          playable: true,
          movie: { title: "Second movie", poster: null },
        },
      ]}
      episodeStatus="next"
    />
  );
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(2);
  expect(screenText()).toContain("0 of 2 picks saved");
  expect(movieText().every((movie) => movie.includes("1 to go"))).toBe(true);
  mocks.savePick.mockResolvedValueOnce({
    id: "saved",
    hostId: "host",
    rating: ratings[0],
  });
  await act(async () =>
    renderer.root.findAllByType("input")[0]!.props.onChange()
  );
  expect(screenText()).toContain("1 of 2 picks saved");
  expect(screenText()).not.toContain("All picks complete");
  const [first, second] = movieText();
  expect(first).toContain("All picked");
  expect(first).toContain("Set wager");
  expect(second).toContain("1 to go");
  expect(second).toContain("Opens when your pick is in.");
  expect(second).not.toContain("Set wager");
});

test("only playable movies contribute to prediction progress", async () => {
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "first",
          playable: true,
          movie: { title: "First movie", poster: null },
        },
        {
          id: "bonus",
          playable: false,
          movie: { title: "Bonus movie", poster: null },
        },
        {
          id: "second",
          playable: true,
          movie: { title: "Second movie", poster: null },
        },
      ]}
      episodeStatus="next"
    />
  );
  expect(screenText()).toContain("0 of 2 picks saved");
  expect(screenText()).not.toContain("0 of 3 picks saved");
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(2);
  const bonus = movieText()[1]!;
  expect(bonus).toContain("Bonus movie");
  expect(bonus).toContain("Not in the game");
  expect(bonus).not.toContain("to go");
  expect(bonus).not.toContain("Wager");

  mocks.savePick.mockResolvedValueOnce({
    id: "saved",
    hostId: "host",
    rating: ratings[0],
  });
  await act(async () =>
    renderer.root.findAllByType("input")[0]!.props.onChange()
  );

  expect(screenText()).toContain("1 of 2 picks saved");
  expect(screenText()).not.toContain("All picks complete");
});

test("live recording changes start a visible countdown and lock an already-open page at its deadline", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const startedAt = Date.parse("2026-09-19T12:00:00Z");
  vi.setSystemTime(startedAt);
  await renderPicks();
  mocks.liveWindow.mockReturnValue({
    status: "recording",
    closesAt: startedAt + 600_000,
  });
  await act(async () => {
    renderer.update(
      <ConvexPredictionGame
        episodeId="episode"
        assignments={[
          {
            id: "assignment",
            playable: true,
            movie: { title: "Test movie", poster: null },
          },
        ]}
        episodeStatus="next"
      />
    );
  });
  expect(screenText()).toContain("Closing soon");
  expect(screenText()).toContain("10:00 left to pick and wager");
  expect(
    renderer.root.findAllByType("fieldset")[0]!.props["aria-disabled"]
  ).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600_000);
  });
  expect(screenText()).toContain("Locked");
  expect(screenText()).toContain("Picks and wagers are final");
  expect(screenText()).toContain("0 of 1 picks locked in · you missed 1");
  expect(movieText()[0]).toContain("No picks made");
  expect(movieText()[0]).toContain("Host OneNo pick");
  expect(screenText()).not.toContain("to go");
  expect(screenText()).not.toContain("Wager");
  expect(screenText()).not.toContain("Locks 10 min");
  expect(renderer.root.findAllByType("input")).toHaveLength(0);
  expect(mocks.savePick).not.toHaveBeenCalled();
});

test("a locked round shows saved picks as a read-only grid without edit prompts", async () => {
  mocks.loadPicks.mockResolvedValue({
    ...initialPicks,
    guessesByAssignment: {
      assignment: [{ id: "g1", hostId: "host", rating: ratings[1] }],
    },
  });
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "assignment",
          playable: true,
          movie: { title: "Test movie", poster: null },
        },
      ]}
      episodeStatus="published"
    />
  );
  expect(screenText()).toContain("Locked");
  expect(screenText()).toContain("Picks and wagers are final");
  expect(screenText()).toContain("1 of 1 picks locked in");
  expect(screenText()).not.toContain("you missed");
  expect(movieText()[0]).toContain("All picked");
  expect(movieText()[0]).toContain("Rating 2");
  expect(movieText()[0]).not.toContain("Rating 1");
  expect(movieText()[0]).not.toContain("No pick");
  expect(renderer.root.findAllByType("input")).toHaveLength(0);
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(1);
});

test("a movie outside the game and an unopened round use their own wording", async () => {
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "bonus",
          playable: false,
          movie: { title: "Bonus movie", poster: null },
        },
      ]}
      episodeStatus="next"
    />
  );
  expect(screenText()).toContain("Open");
  expect(screenText()).toContain("Not in the game");
  expect(screenText()).not.toContain("picks saved");
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(0);
  act(() => renderer.unmount());
  await render(
    <ConvexPredictionGame
      episodeId="episode"
      assignments={[
        {
          id: "assignment",
          playable: true,
          movie: { title: "Test movie", poster: null },
        },
      ]}
      episodeStatus="draft"
    />
  );
  expect(screenText()).toContain("Not open yet");
  expect(screenText()).toContain("Picks aren’t open for this episode yet.");
  expect(screenText()).not.toContain("Locked");
  expect(screenText()).toContain("Test movie");
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(0);
});

test("a pick in flight keeps its cells focusable and ignores a second choice", async () => {
  const request = deferred<unknown>();
  mocks.savePick.mockReturnValueOnce(request.promise);
  await renderPicks();
  const cells = () => renderer.root.findAllByType("input");
  await act(async () => {
    cells()[0]!.props.onChange();
  });
  expect(cells().map((cell) => cell.props.disabled)).toEqual([
    undefined,
    undefined,
  ]);
  expect(cells().map((cell) => cell.props["aria-disabled"])).toEqual([
    true,
    true,
  ]);
  await act(async () => {
    cells()[1]!.props.onChange();
  });
  expect(mocks.savePick).toHaveBeenCalledTimes(1);
  expect(cells()[0]!.props.checked).toBe(true);
  await act(async () => {
    request.resolve({ id: "guess", hostId: "host", rating: ratings[0] });
  });
  expect(cells().map((cell) => cell.props["aria-disabled"])).toEqual([
    false,
    false,
  ]);
});

test("Retry save hands focus to the saved pick, or back to itself when it fails again", async () => {
  const focused: string[] = [];
  await act(async () => {
    renderer = create(
      <ConvexPredictionGame
        episodeId="episode"
        assignments={[
          {
            id: "assignment",
            playable: true,
            movie: { title: "Test movie", poster: null },
          },
        ]}
        episodeStatus="next"
      />,
      {
        createNodeMock: (element) => ({
          focus: () =>
            focused.push(
              element.type === "input"
                ? `cell ${String(element.props.value)}`
                : String(element.props.children)
            ),
          scrollIntoView: vi.fn(),
        }),
      }
    );
  });
  const pick = (index: number) =>
    act(async () => {
      renderer.root.findAllByType("input")[index]!.props.onChange();
    });

  // A pick that fails leaves focus on the cell the listener chose.
  mocks.savePick.mockRejectedValueOnce(new Error("offline"));
  await pick(0);
  expect(focused).toEqual([]);

  mocks.savePick.mockRejectedValueOnce(new Error("offline"));
  await click("Retry save");
  expect(focused).toEqual(["Retry save"]);

  mocks.savePick.mockResolvedValueOnce({
    id: "guess",
    hostId: "host",
    rating: ratings[0],
  });
  await click("Retry save");
  expect(focused).toEqual(["Retry save", "cell r1"]);

  // Focus is handed over once; a later pick does not pull it back.
  mocks.savePick.mockResolvedValueOnce({
    id: "guess",
    hostId: "host",
    rating: ratings[1],
  });
  await pick(1);
  expect(focused).toEqual(["Retry save", "cell r1"]);
});
