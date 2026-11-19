// The adapter and confirm modal are stand-ins; no DOM.
import { ConvexError } from "convex/values";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type * as FeedbackAdapter from "@/convex/feedback";
import type { ConvexAdminFeedback } from "@/convex/feedback";

const mocks = vi.hoisted(() => ({
  client: {},
  load: vi.fn<(client: unknown, status: string) => Promise<unknown>>(),
  counts: vi.fn<(client: unknown) => Promise<unknown>>(),
  setStatus: vi.fn<
    (client: unknown, id: string, status: string) => Promise<unknown>
  >(),
  remove: vi.fn<(client: unknown, id: string) => Promise<unknown>>(),
  confirm: null as null | {
    description: string;
    onConfirm: () => void;
    onClose: () => void;
  },
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/convex/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof FeedbackAdapter>()),
  loadConvexAdminFeedback: mocks.load,
  loadConvexAdminFeedbackCounts: mocks.counts,
  setConvexAdminFeedbackStatus: mocks.setStatus,
  deleteConvexAdminFeedback: mocks.remove,
}));
vi.mock("../ui/confirm-modal", () => ({
  ConfirmModal: (props: {
    isOpen: boolean;
    description: string;
    onConfirm: () => void;
    onClose: () => void;
  }) => {
    mocks.confirm = props.isOpen ? props : null;
    return props.isOpen ? <aside>{props.description}</aside> : null;
  },
}));

import { toast } from "sonner";

import { ConvexFeedbackPage } from "./ConvexFeedbackPage";

function feedback(
  id: string,
  overrides: Partial<ConvexAdminFeedback> = {}
): ConvexAdminFeedback {
  return {
    id,
    category: "idea",
    message: `Message ${id}`,
    pagePath: "/history",
    status: "new",
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    submitter: { id: `user-${id}`, name: `Listener ${id}`, email: null },
    ...overrides,
  };
}

const COUNTS = { new: 2, reviewed: 0, archived: 0, cap: 99 };

let renderer: ReactTestRenderer | null = null;

function root(): ReactTestInstance {
  if (renderer === null) throw new Error("Expected a rendered page");
  return renderer.root;
}

function text(): string {
  return JSON.stringify(renderer?.toJSON()).replace(/","/gu, "");
}

function button(label: string): ReactTestInstance {
  const match = root()
    .findAllByType("button")
    .find(
      (node) =>
        node.props["aria-label"] === label ||
        node.findAll((child) =>
          child.children.some((value) => value === label)
        ).length > 0
    );
  if (match === undefined) throw new Error(`Expected a button labelled ${label}`);
  return match;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    (button(label).props as { onClick: () => void }).onClick();
  });
  await act(() => Promise.resolve());
}

function strings(node: ReactTestInstance | string): string[] {
  return typeof node === "string" ? [node] : node.children.flatMap(strings);
}

function selectedDetail(): string {
  const article = root().find(
    (node) =>
      node.type === "article" && node.props["aria-label"] === "Selected feedback"
  );
  return strings(article).join(" ");
}

async function render(): Promise<void> {
  await act(async () => {
    renderer = create(<ConvexFeedbackPage />);
  });
  await act(() => Promise.resolve());
}

afterEach(() => {
  if (renderer !== null) {
    act(() => renderer?.unmount());
    renderer = null;
  }
  mocks.confirm = null;
  vi.resetAllMocks();
});

describe("admin feedback inbox", () => {
  test("shows new feedback with counts and the newest selected", async () => {
    mocks.load.mockResolvedValue({
      items: [
        feedback("a", { message: "Newest note", category: "bug" }),
        feedback("b", { message: "Older note" }),
      ],
      hasMore: false,
    });
    mocks.counts.mockResolvedValue(COUNTS);
    await render();

    expect(mocks.load).toHaveBeenCalledWith(mocks.client, "new");
    expect(text()).toContain("Listener a");
    expect(text()).toContain("Older note");
    expect(selectedDetail()).toContain("Newest note");
    expect(selectedDetail()).toContain("/history");
  });

  test("marks feedback reviewed, moves on and reloads", async () => {
    mocks.load
      .mockResolvedValueOnce({
        items: [feedback("a"), feedback("b")],
        hasMore: false,
      })
      .mockResolvedValue({ items: [feedback("b")], hasMore: false });
    mocks.counts.mockResolvedValue(COUNTS);
    mocks.setStatus.mockResolvedValue(feedback("a", { status: "reviewed" }));
    await render();

    await click("Mark reviewed");

    expect(mocks.setStatus).toHaveBeenCalledWith(mocks.client, "a", "reviewed");
    expect(toast.success).toHaveBeenCalledWith("Moved to Reviewed.");
    expect(text()).not.toContain("Listener a");
    expect(selectedDetail()).toContain("Message b");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.counts).toHaveBeenCalledTimes(2);
  });

  test("keeps a selection made while a change is in flight", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.load
      .mockResolvedValueOnce({
        items: [feedback("a"), feedback("b"), feedback("c")],
        hasMore: false,
      })
      .mockResolvedValue({
        items: [feedback("b"), feedback("c")],
        hasMore: false,
      });
    mocks.counts.mockResolvedValue(COUNTS);
    mocks.setStatus.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    await render();

    await click("Mark reviewed");
    await click("Listener c");
    await act(async () => {
      finish(feedback("a", { status: "reviewed" }));
    });
    await act(() => Promise.resolve());

    expect(selectedDetail()).toContain("Message c");
  });

  test("refills the page instead of claiming the inbox is empty", async () => {
    mocks.load
      .mockResolvedValueOnce({ items: [feedback("a")], hasMore: true })
      .mockResolvedValue({ items: [feedback("old")], hasMore: false });
    mocks.counts.mockResolvedValue(COUNTS);
    mocks.setStatus.mockResolvedValue(feedback("a", { status: "archived" }));
    await render();
    expect(text()).toContain("Showing the newest 100.");

    await click("Archive");

    expect(text()).not.toContain("You're all caught up.");
    expect(text()).toContain("Listener old");
  });

  test("an empty category on a truncated page is not stuck loading", async () => {
    mocks.load.mockResolvedValue({ items: [feedback("a")], hasMore: true });
    mocks.counts.mockResolvedValue(COUNTS);
    await render();

    await click("Praise");

    expect(text()).toContain("Nothing here.");
    expect(text()).toContain("No praise feedback in the newest 100 here.");
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  test("a change supersedes a reload already in flight", async () => {
    let staleLoad: (value: unknown) => void = () => undefined;
    mocks.load
      .mockResolvedValueOnce({
        items: [feedback("a"), feedback("b")],
        hasMore: false,
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          staleLoad = resolve;
        })
      )
      .mockResolvedValue({ items: [feedback("b")], hasMore: false });
    mocks.counts.mockResolvedValue(COUNTS);
    mocks.setStatus.mockResolvedValue(feedback("a", { status: "reviewed" }));
    await render();

    await click("Refresh");
    await click("Mark reviewed");
    await act(async () => {
      staleLoad({ items: [feedback("a"), feedback("b")], hasMore: false });
    });
    await act(() => Promise.resolve());

    expect(text()).not.toContain("Listener a");
    expect(text()).toContain("Listener b");
  });

  test("filters by category and switches status tabs", async () => {
    mocks.load.mockResolvedValue({
      items: [
        feedback("a", { category: "bug", message: "Broken player" }),
        feedback("b", { category: "praise", message: "Love the show" }),
      ],
      hasMore: false,
    });
    mocks.counts.mockResolvedValue(COUNTS);
    await render();

    await click("Praise");
    expect(text()).toContain("Love the show");
    expect(text()).not.toContain("Broken player");

    mocks.load.mockResolvedValue({ items: [], hasMore: false });
    await click("Archived");
    expect(mocks.load).toHaveBeenLastCalledWith(mocks.client, "archived");
    expect(text()).toContain("Nothing here.");
  });

  test("shows an empty inbox", async () => {
    mocks.load.mockResolvedValue({ items: [], hasMore: false });
    mocks.counts.mockResolvedValue({ ...COUNTS, new: 0 });
    await render();
    expect(text()).toContain("You're all caught up.");
  });

  test("confirms before deleting and reports failures", async () => {
    mocks.load.mockResolvedValue({ items: [feedback("a")], hasMore: false });
    mocks.counts.mockResolvedValue(COUNTS);
    mocks.remove.mockRejectedValue(
      new ConvexError({ code: "WRITE_DISABLED", message: "paused" })
    );
    await render();

    await click("Delete feedback");
    expect(mocks.remove).not.toHaveBeenCalled();
    const modal = mocks.confirm;
    if (modal === null) throw new Error("Expected a confirm modal");
    await act(async () => {
      modal.onConfirm();
      modal.onClose();
    });
    await act(() => Promise.resolve());

    expect(mocks.remove).toHaveBeenCalledWith(mocks.client, "a");
    expect(toast.error).toHaveBeenCalledWith(
      "Feedback changes are paused in this environment."
    );
    expect(text()).toContain("Listener a");
  });

  test("offers a retry when loading fails", async () => {
    mocks.load.mockRejectedValueOnce(new Error("offline"));
    mocks.counts.mockResolvedValue(COUNTS);
    await render();
    expect(text()).toContain("Feedback could not be loaded");

    mocks.load.mockResolvedValue({ items: [feedback("a")], hasMore: false });
    await click("Try again");
    expect(text()).toContain("Listener a");
  });
});
