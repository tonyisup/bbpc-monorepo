import React, { useState, type ReactNode } from "react";
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
  await click("Make picks");
}
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

test("wager review explains the exact whole-point return before submission", async () => {
  const submit = vi.fn();
  await render(
    <BettingCoin
      type={{ id: "type", multiplier: 1.5 }}
      label="One host"
      description="Predict one host correctly"
      payoutTone="standard"
      existingBet={undefined}
      assignmentId="assignment"
      userPoints={100}
      isRoundOpen
      onSubmit={submit}
    />
  );
  await click("Set wager");
  act(() =>
    renderer.root.findByType("input").props.onChange({ target: { value: "3" } })
  );
  act(() =>
    renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() })
  );
  expect(screenText()).toContain(
    "A loss costs 3 points. A win earns 4 points in profit and returns 7 points total, including your wager."
  );
  expect(submit).not.toHaveBeenCalled();
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
  await click("View or edit picks");
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

test("voice drafts and accessible actions survive hiding and reopening picks", async () => {
  await renderPicks();
  await click("Record voice message");
  expect(screenText()).toContain("Ready to send");
  await click("Hide picks");
  await click("Make picks");
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

test("all movie cards start closed and finishing one points to the remaining movie", async () => {
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
  expect(renderer.root.findAllByType("fieldset")).toHaveLength(0);
  expect(screenText()).toContain("0 of 2 movies complete");
  await click("Make picks");
  mocks.savePick.mockResolvedValueOnce({
    id: "saved",
    hostId: "host",
    rating: ratings[0],
  });
  await act(async () =>
    renderer.root.findAllByType("input")[0]!.props.onChange()
  );
  expect(screenText()).toContain("1 of 2 movies complete");
  expect(screenText()).not.toContain("All picks complete");
  expect(button("Make picks").props["aria-expanded"]).toBe(false);
  await click("Continue to Second movie");
  expect(
    renderer.root
      .findAllByType("button")
      .filter((node) => text(node).trim() === "Hide picks")
  ).toHaveLength(2);
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
  expect(screenText()).toContain("Picks and wagers close in 10:00");
  expect(renderer.root.findAllByType("fieldset")[0]!.props.disabled).toBe(
    false
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600_000);
  });
  expect(screenText()).toContain("Picks locked");
  expect(renderer.root.findAllByType("fieldset")[0]!.props.disabled).toBe(true);
  await act(async () =>
    renderer.root.findAllByType("input")[0]!.props.onChange()
  );
  expect(mocks.savePick).not.toHaveBeenCalled();
});
