import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type * as QuotabungaAdapter from "@/convex/quotabunga";
import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

import type * as MarkerModule from "./QuoteClipMarker";

type MarkerProps = Parameters<typeof MarkerModule.QuoteClipMarker>[0];
interface PromptProps {
  isOpen: boolean;
  title: string;
  description: string;
  cancelText?: string;
  onClose: () => void;
  onConfirm: () => void;
}

const mocks = vi.hoisted(() => ({
  client: {},
  loadEpisodes: vi.fn(),
  loadSubmissions: vi.fn(),
  loadSubmission: vi.fn(),
  loadUsers: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  marker: null as MarkerProps | null,
  dialogContents: [] as Array<{ onOpenAutoFocus?: (event: unknown) => void }>,
  prompts: new Map<string, PromptProps>(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/router", () => ({
  useRouter: () => ({ query: {}, beforePopState: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/convex/quotabunga", async (importOriginal) => ({
  ...(await importOriginal<typeof QuotabungaAdapter>()),
  loadConvexAdminQuoteEpisodes: mocks.loadEpisodes,
  loadConvexAdminQuoteSubmissions: mocks.loadSubmissions,
  loadConvexAdminQuoteSubmission: mocks.loadSubmission,
  updateConvexAdminQuoteContent: mocks.update,
}));
vi.mock("@/convex/users", () => ({
  loadConvexAdminUsersPage: mocks.loadUsers,
}));
// Radix portals need a DOM; these stand-ins render an open dialog in place.
vi.mock("../ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: ({
      children,
      open,
    }: {
      children?: ReactNode;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => (open ? <>{children}</> : null),
    DialogContent: (props: {
      children?: ReactNode;
      onOpenAutoFocus?: (event: unknown) => void;
    }) => {
      mocks.dialogContents.push(props);
      return <>{props.children}</>;
    },
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});
vi.mock("../ui/confirm-modal", () => ({
  ConfirmModal: (props: PromptProps) => {
    if (props.isOpen) mocks.prompts.set(props.title, props);
    return props.isOpen ? <aside>{props.description}</aside> : null;
  },
}));
vi.mock("./QuoteClipMarker", async (importOriginal) => ({
  ...(await importOriginal<typeof MarkerModule>()),
  QuoteClipMarker: (props: MarkerProps) => {
    mocks.marker = props;
    return <div data-marker />;
  },
}));

import { toast } from "sonner";

import { Dialog } from "../ui/dialog";
import { ConvexQuotabungaPage } from "./ConvexQuotabungaPage";
import { clipTimesUpdate, EntryChangedError } from "./QuoteClipMarker";

let view: ReactTestRenderer;
// The entries as the server has them now, for saves that re-read one.
const latest = new Map<string, ConvexAdminQuoteSubmission>();

function submission(
  id: string,
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id,
    quoteText: `Line ${id}`,
    sourceTitle: `Source ${id}`,
    sourceType: "MOVIE",
    clipUrl: `https://youtu.be/${id.repeat(11)}?t=40`,
    clipStartSeconds: 40,
    clipEndSeconds: null,
    listenerNotes: null,
    status: "SUBMITTED",
    bracketOrder: null,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
    userId: `user-${id}`,
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: null,
    user: {
      id: `user-${id}`,
      name: `Listener ${id.toUpperCase()}`,
      email: `${id}@listeners.test`,
      image: null,
    },
    episode: { id: "episode-1", number: 1, title: "Pilot", status: "next" },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");
const text = () => textOf(view.root);
const buttons = (label: string) =>
  view.root
    .findAllByType("button")
    .filter((node) => textOf(node).trim() === label);
const button = (label: string) => {
  const found = buttons(label)[0];
  if (found === undefined) throw new Error(`No button labeled ${label}`);
  return found;
};
const click = (label: string, index = 0) =>
  act(() => buttons(label)[index]?.props.onClick());
const search = () =>
  view.root
    .findAllByType("input")
    .find((node) => node.props.id === "quote-search");
const typeSearch = (value: string) =>
  act(() => search()?.props.onChange({ target: { value } }));
const markerOpen = () => view.root.findAllByProps({ "data-marker": true });
const closeMarker = () => {
  const dialog = view.root
    .findAllByType(Dialog)
    .find((node) => node.findAllByProps({ "data-marker": true }).length > 0);
  act(() => dialog?.props.onOpenChange(false));
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

async function render(entries: ConvexAdminQuoteSubmission[]) {
  latest.clear();
  entries.forEach((entry) => latest.set(entry.id, entry));
  mocks.loadSubmissions.mockImplementation(
    async (_client: unknown, episodeId: string) =>
      episodeId === "episode-1" ? entries : []
  );
  await act(async () => {
    view = create(<ConvexQuotabungaPage />);
  });
  await flush();
}

describe("Quotabunga prep page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marker = null;
    mocks.dialogContents = [];
    mocks.prompts.clear();
    mocks.confirm.mockReturnValue(true);
    // Saves re-read the entry; by default nobody has changed it meanwhile.
    mocks.loadSubmission.mockImplementation(
      async (_client: unknown, id: string) => latest.get(id) ?? null
    );
    vi.stubGlobal("window", {
      confirm: mocks.confirm,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    mocks.loadEpisodes.mockResolvedValue([
      {
        id: "episode-1",
        number: 1,
        title: "Pilot",
        status: "next",
        submissionCount: 2,
      },
      {
        id: "episode-2",
        number: 2,
        title: "Sequel",
        status: null,
        submissionCount: 0,
      },
    ]);
    mocks.loadUsers.mockResolvedValue({ users: [], isDone: true });
  });

  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  test("keeps listener names hidden, and out of search, until shown on purpose", async () => {
    await render([submission("a"), submission("b", { sourceTitle: "Heat" })]);
    expect(text()).not.toContain("Listener A");
    expect(text()).toContain("Name hidden");
    expect(search()?.props.placeholder).toBe("Source or quote...");

    // A name or email match would reveal whose entry it is.
    typeSearch("listener a");
    expect(text()).toContain("No Quotabunga submissions match this view.");
    typeSearch("a@listeners");
    expect(text()).toContain("No Quotabunga submissions match this view.");
    typeSearch("heat");
    expect(text()).toContain("Line b");
    typeSearch("");

    click("Delete");
    // With names hidden, the entry is named by its source and quote.
    expect(view.root.findByType("aside").children.join("")).toContain(
      "Delete the Source a entry “Line a”?"
    );

    click("Show names");
    expect(text()).toContain("Listener A");
    expect(search()?.props.placeholder).toBe("Listener, source, or quote...");
    typeSearch("a@listeners");
    expect(text()).toContain("Line a");
    expect(text()).not.toContain("Line b");
    typeSearch("");
    click("Delete");
    expect(view.root.findByType("aside").children.join("")).toContain(
      "Delete Listener A’s submission"
    );

    // Names shown for one episode stay hidden for the next.
    const episode = view.root
      .findAllByType("select")
      .find((node) => node.props.id === "episode-filter");
    act(() => episode?.props.onChange({ target: { value: "episode-2" } }));
    await flush();
    expect(buttons("Show names")).toHaveLength(1);
  });

  test("shows names with no toggle once any entry is scored", async () => {
    await render([
      submission("a", { status: "INCLUDED", placement: 1, scored: true }),
      submission("b"),
    ]);
    expect(text()).toContain("Listener A");
    expect(text()).toContain("Listener B");
    expect(buttons("Show names")).toHaveLength(0);
  });

  test("offers Mark clip only for YouTube links, and Mark clips steps through this view's unscored ones", async () => {
    await render([
      submission("a"),
      submission("b", { status: "INCLUDED", placement: 1, scored: true }),
      submission("c", { clipUrl: "https://vimeo.com/1" }),
      submission("d", { clipUrl: null, clipStartSeconds: null }),
      submission("e", { status: "REJECTED" }),
    ]);
    const markClip = buttons("Clip");
    expect(markClip).toHaveLength(3);
    expect(markClip.map((node) => node.props.disabled)).toEqual([
      false,
      true,
      false,
    ]);

    click("Mark clips");
    expect(mocks.marker?.initialId).toBe("a");
    expect(mocks.marker?.queue.map((entry) => entry.id)).toEqual(["a", "e"]);
    expect(mocks.marker?.showListener).toBe(true);
    closeMarker();
    expect(markerOpen()).toHaveLength(0);
    expect(mocks.confirm).not.toHaveBeenCalled();

    click("Rejected 1");
    click("Clip");
    expect(mocks.marker?.initialId).toBe("e");
    expect(mocks.marker?.queue.map((entry) => entry.id)).toEqual(["e"]);
    closeMarker();

    click("All 5");
    typeSearch("Source c");
    expect(button("Mark clips").props.disabled).toBe(true);
  });

  test("saves marked times as a content update, explains failures, and reloads the round on close", async () => {
    const entry = submission("a", { listenerNotes: "Diner scene" });
    await render([entry]);
    click("Clip");
    const onSave = mocks.marker?.onSave;
    if (onSave === undefined) throw new Error("The marker didn't open");
    expect(mocks.marker?.showListener).toBe(false);

    const saved = { ...entry, clipStartSeconds: 42.3, clipEndSeconds: 44.1 };
    mocks.update.mockResolvedValueOnce(saved);
    await expect(onSave(entry, { start: 42.3, end: 44.1 })).resolves.toBe(
      saved
    );
    expect(mocks.update).toHaveBeenCalledWith(
      mocks.client,
      clipTimesUpdate(entry, "aaaaaaaaaaa", { start: 42.3, end: 44.1 })
    );

    mocks.update.mockRejectedValueOnce(
      new ConvexError({ code: "WRITE_DISABLED", message: "Paused" })
    );
    await expect(onSave(entry, { start: 1, end: null })).rejects.toThrow(
      "Quotabunga changes are paused in this environment."
    );
    // The save uses the entry as re-read, not the marker's copy.
    latest.set("a", { ...entry, clipUrl: "https://vimeo.com/1" });
    await expect(onSave(entry, { start: 1, end: null })).rejects.toThrow(
      "This entry no longer has a YouTube link."
    );

    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(1);
    closeMarker();
    await flush();
    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(2);

    // Closing without a save leaves the round as loaded.
    click("Clip");
    closeMarker();
    await flush();
    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(2);
  });

  test("refuses to save over a changed entry, hands the marker the latest copy, and reloads on close", async () => {
    const entry = submission("a");
    await render([entry]);
    click("Clip");
    const onSave = mocks.marker?.onSave;
    if (onSave === undefined) throw new Error("The marker didn't open");

    // The listener edited their quote after the marker loaded it.
    const newer = { ...entry, quoteText: "Newer line", updatedAt: 2 };
    latest.set("a", newer);
    const changed = await onSave(entry, { start: 42.3, end: null }).catch(
      (error: unknown) => error
    );
    expect(changed).toBeInstanceOf(EntryChangedError);
    expect((changed as EntryChangedError).latest).toEqual(newer);

    latest.delete("a");
    const deleted = await onSave(entry, { start: 42.3, end: null }).catch(
      (error: unknown) => error
    );
    expect((deleted as EntryChangedError).latest).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();

    // Closing reloads the round, so a reopened marker gets the new copy.
    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(1);
    closeMarker();
    await flush();
    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(2);
  });

  test("a failed re-read explains itself and sends no update", async () => {
    const entry = submission("a");
    await render([entry]);
    click("Clip");
    mocks.loadSubmission.mockRejectedValueOnce(
      new ConvexError({ code: "WRITE_DISABLED", message: "Paused" })
    );
    await expect(
      mocks.marker?.onSave(entry, { start: 1, end: null })
    ).rejects.toThrow("Quotabunga changes are paused in this environment.");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("a save that fails after the dialog closed is reported", async () => {
    const entry = submission("a");
    await render([entry]);
    click("Clip");
    const onSave = mocks.marker?.onSave;
    if (onSave === undefined) throw new Error("The marker didn't open");
    let fail: (error: unknown) => void = () => undefined;
    mocks.update.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      })
    );
    const pending = onSave(entry, { start: 42.3, end: null });
    await flush();
    closeMarker();
    await act(async () => {
      fail(new ConvexError({ code: "WRITE_DISABLED", message: "Paused" }));
      await pending.catch(() => undefined);
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Quotabunga changes are paused in this environment."
    );
  });

  test("the marker dialog focuses itself, not its first button", async () => {
    await render([submission("a")]);
    click("Clip");
    const handler = mocks.dialogContents
      .map((props) => props.onOpenAutoFocus)
      .find((onOpenAutoFocus) => onOpenAutoFocus !== undefined);
    const focus = vi.fn();
    const preventDefault = vi.fn();
    handler?.({ preventDefault, currentTarget: { focus } });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  test("unsaved marks arm the leave-page prompt", async () => {
    await render([submission("a")]);
    click("Clip");
    const addEventListener = window.addEventListener as ReturnType<
      typeof vi.fn
    >;
    expect(addEventListener).not.toHaveBeenCalledWith(
      "beforeunload",
      expect.anything()
    );
    act(() => mocks.marker?.onDirtyChange?.(true));
    expect(addEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function)
    );
  });

  test("a save that lands after the dialog closed still reloads the round", async () => {
    const entry = submission("a");
    await render([entry]);
    click("Clip");
    const onSave = mocks.marker?.onSave;
    if (onSave === undefined) throw new Error("The marker didn't open");

    let finish: (value: ConvexAdminQuoteSubmission) => void = () => undefined;
    mocks.update.mockReturnValueOnce(
      new Promise<ConvexAdminQuoteSubmission>((resolve) => {
        finish = resolve;
      })
    );
    const pending = onSave(entry, { start: 42.3, end: null });
    closeMarker();
    await flush();
    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ ...entry, clipStartSeconds: 42.3 });
      await pending;
    });
    await flush();
    expect(mocks.loadSubmissions).toHaveBeenCalledTimes(2);
  });

  test("asks before closing over unsaved marks, with Keep marking as the safe choice", async () => {
    await render([submission("a")]);
    click("Clip");
    act(() => mocks.marker?.onDirtyChange?.(true));

    closeMarker();
    const prompt = () => mocks.prompts.get("Discard unsaved clip times?");
    expect(prompt()?.cancelText).toBe("Keep marking");
    // The marker's shortcuts wait while the prompt is open.
    expect(mocks.marker?.paused).toBe(true);
    act(() => prompt()?.onClose());
    expect(markerOpen()).toHaveLength(1);
    expect(mocks.marker?.paused).toBe(false);

    // The marker's Done button closes the same way.
    act(() => mocks.marker?.onDone?.());
    act(() => prompt()?.onConfirm());
    expect(markerOpen()).toHaveLength(0);

    // A reopened marker starts clean and closes without asking.
    mocks.prompts.clear();
    click("Clip");
    closeMarker();
    expect(mocks.prompts.size).toBe(0);
    expect(markerOpen()).toHaveLength(0);
  });
});
