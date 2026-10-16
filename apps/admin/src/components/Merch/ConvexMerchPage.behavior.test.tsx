// The adapter, dialog, checkbox and confirm modal are stand-ins; no DOM.
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type * as MerchAdapter from "@/convex/merch";
import type { ConvexAdminMerchItem } from "@/convex/merch";

const mocks = vi.hoisted(() => ({
  client: {},
  load: vi.fn<(client: unknown) => Promise<unknown>>(),
  create: vi.fn<(client: unknown, input: unknown) => Promise<unknown>>(),
  update: vi.fn<
    (client: unknown, id: string, input: unknown) => Promise<unknown>
  >(),
  setVisible: vi.fn<
    (client: unknown, id: string, visible: boolean) => Promise<unknown>
  >(),
  move: vi.fn<
    (client: unknown, id: string, direction: string) => Promise<unknown>
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
vi.mock("@/convex/merch", async (importOriginal) => ({
  ...(await importOriginal<typeof MerchAdapter>()),
  loadConvexAdminMerchItems: mocks.load,
  createConvexAdminMerchItem: mocks.create,
  updateConvexAdminMerchItem: mocks.update,
  setConvexAdminMerchItemVisible: mocks.setVisible,
  moveConvexAdminMerchItem: mocks.move,
  deleteConvexAdminMerchItem: mocks.remove,
}));
// Radix portals need a DOM; these stand-ins render an open dialog in place.
vi.mock("../ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) =>
      open ? <>{children}</> : null,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});
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
vi.mock("../ui/checkbox", () => ({
  Checkbox: ({
    checked,
    id,
    onCheckedChange,
  }: {
    checked: boolean;
    id: string;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      checked={checked}
      id={id}
      onChange={() => onCheckedChange(!checked)}
      type="checkbox"
    />
  ),
}));

import { toast } from "sonner";

import { ConvexMerchPage } from "./ConvexMerchPage";

function item(
  id: string,
  overrides: Partial<ConvexAdminMerchItem> = {}
): ConvexAdminMerchItem {
  return {
    id,
    title: `Item ${id}`,
    description: null,
    url: `https://www.teepublic.com/t-shirt/${id}`,
    imageUrl: null,
    priceLabel: null,
    badge: null,
    featured: false,
    visible: true,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

let renderer: ReactTestRenderer | null = null;

function root(): ReactTestInstance {
  if (renderer === null) {
    throw new Error("Expected a rendered page");
  }
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
  if (match === undefined) {
    throw new Error(`Expected a button labelled ${label}`);
  }
  return match;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    (button(label).props as { onClick: () => void }).onClick();
  });
  await act(() => Promise.resolve());
}

function type(id: string, value: string): void {
  const field = root().find(
    (node) =>
      (node.type === "input" || node.type === "textarea") &&
      node.props.id === id
  );
  act(() => {
    (field.props as { onChange: (event: unknown) => void }).onChange({
      target: { value },
    });
  });
}

function toggle(id: string): void {
  const box = root().find(
    (node) => node.type === "input" && node.props.id === id
  );
  act(() => {
    (box.props as { onChange: () => void }).onChange();
  });
}

// The real modal calls onConfirm and then closes itself.
async function confirmModal(): Promise<void> {
  const modal = mocks.confirm;
  if (modal === null) {
    throw new Error("Expected an open confirm modal");
  }
  await act(async () => {
    modal.onConfirm();
    modal.onClose();
  });
  await act(() => Promise.resolve());
}

async function render(): Promise<void> {
  await act(async () => {
    renderer = create(<ConvexMerchPage />);
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

describe("ConvexMerchPage", () => {
  test("blocks invalid items and saves trimmed fields with blanks cleared", async () => {
    mocks.load.mockResolvedValue([]);
    mocks.create.mockResolvedValue(item("new"));
    await render();
    expect(text()).toContain("No items yet.");

    await click("New Item");
    await click("Save Item");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(text()).toContain("A title is required.");
    expect(text()).toContain(
      "The product link must start with http:// or https://."
    );

    type("convex-merch-title", "x".repeat(81));
    type("convex-merch-url", " https://www.teepublic.com/t-shirt/1 ");
    type("convex-merch-image", "ftp://images.example.test/tee.jpg");
    type("convex-merch-description", "x".repeat(201));
    type("convex-merch-price", "x".repeat(25));
    type("convex-merch-badge", "x".repeat(21));
    await click("Save Item");
    expect(mocks.create).not.toHaveBeenCalled();
    for (const error of [
      "The title must be 80 characters or fewer.",
      "The image link must start with https://.",
      "The description must be 200 characters or fewer.",
      "The price label must be 24 characters or fewer.",
      "The badge must be 20 characters or fewer.",
    ]) {
      expect(text()).toContain(error);
    }

    type("convex-merch-title", "  Logo Tee  ");

    type("convex-merch-image", "   ");
    type("convex-merch-badge", " ");
    type("convex-merch-description", "  ");
    type("convex-merch-price", " From $22 ");
    toggle("convex-merch-featured");
    toggle("convex-merch-visible");
    expect(text()).toContain("If this is the first featured item");
    await click("Save Item");

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[1]).toEqual({
      title: "Logo Tee",
      description: null,
      url: "https://www.teepublic.com/t-shirt/1",
      imageUrl: null,
      priceLabel: "From $22",
      badge: null,
      featured: true,
      visible: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Item added.");
    // The editor closes and the list reloads from the server.
    expect(text()).not.toContain("Save Item");
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  test("toggles visibility in place and explains failed writes", async () => {
    const tee = item("tee", { priceLabel: "From $22", badge: "New" });
    mocks.load.mockResolvedValue([tee]);
    mocks.setVisible.mockResolvedValueOnce({ ...tee, visible: false });
    await render();
    expect(text()).toContain("Visible");

    await click("Hide Item tee");
    // Only visibility is sent, so a stale row cannot overwrite other fields.
    expect(mocks.setVisible).toHaveBeenCalledWith(mocks.client, "tee", false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Item hidden.");
    expect(text()).toContain("Hidden");
    expect(mocks.load).toHaveBeenCalledTimes(1);

    for (const [code, message] of [
      ["NOT_FOUND", "That item no longer exists."],
      ["WRITE_DISABLED", "Merch changes are paused in this environment."],
      ["CONFLICT", "The shop can hold 48 items. Delete one first."],
    ] as const) {
      mocks.setVisible.mockRejectedValueOnce(
        new ConvexError({ code, message: "Rejected" })
      );
      await click("Show Item tee");
      expect(toast.error).toHaveBeenLastCalledWith(message);
    }
    mocks.setVisible.mockRejectedValueOnce(new Error("offline"));
    await click("Show Item tee");
    expect(toast.error).toHaveBeenLastCalledWith(
      "The merch change could not be completed."
    );
    // A failed write leaves the row as it was and re-enables the actions.
    expect(text()).toContain("Hidden");
    expect(button("Show Item tee").props.disabled).toBe(false);
  });

  test("retries a failed load and guards both ends of the order", async () => {
    mocks.load.mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(text()).toContain("Merch could not be loaded. Try again.");

    const first = item("first", { sortOrder: 0 });
    const second = item("second", { sortOrder: 1 });
    mocks.load.mockResolvedValueOnce([first, second]);
    await click("Try again");
    expect(text()).not.toContain("Merch could not be loaded.");
    expect(button("Move Item first up").props.disabled).toBe(true);
    expect(button("Move Item first down").props.disabled).toBe(false);
    expect(button("Move Item second up").props.disabled).toBe(false);
    expect(button("Move Item second down").props.disabled).toBe(true);

    mocks.move.mockResolvedValueOnce([
      { ...second, sortOrder: 0 },
      { ...first, sortOrder: 1 },
    ]);
    await click("Move Item first down");
    expect(mocks.move).toHaveBeenCalledWith(mocks.client, "first", "down");
    expect(button("Move Item second up").props.disabled).toBe(true);
    expect(button("Move Item first down").props.disabled).toBe(true);
    expect(button("New Item").props.disabled).toBe(false);
  });

  test("deletes an item only after confirmation", async () => {
    mocks.load.mockResolvedValue([item("tee")]);
    await render();

    await click("Delete Item tee");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(text()).toContain("Delete “Item tee” from the shop page?");

    mocks.remove.mockRejectedValueOnce(
      new ConvexError({ code: "NOT_FOUND", message: "Gone" })
    );
    await confirmModal();
    expect(toast.error).toHaveBeenLastCalledWith("That item no longer exists.");
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toBeNull();
    expect(text()).not.toContain("from the shop page?");

    mocks.remove.mockResolvedValueOnce(undefined);
    await click("Delete Item tee");
    await confirmModal();
    expect(mocks.remove).toHaveBeenLastCalledWith(mocks.client, "tee");
    expect(toast.success).toHaveBeenCalledWith("Item deleted.");
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  test("edits an existing item through update", async () => {
    const tee = item("tee", {
      description: "The classic.",
      imageUrl: "https://images.example.test/tee.jpg",
      priceLabel: "From $22",
      badge: "New",
      featured: true,
      visible: false,
    });
    mocks.load.mockResolvedValue([tee]);
    mocks.update.mockResolvedValueOnce({ ...tee, title: "Logo Tee" });
    await render();

    await click("Edit Item tee");
    expect(text()).toContain("Edit Merch Item");
    const titleField = root().find(
      (node) => node.type === "input" && node.props.id === "convex-merch-title"
    );
    expect(titleField.props.value).toBe("Item tee");

    type("convex-merch-title", " Logo Tee ");
    await click("Save Item");

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(mocks.client, "tee", {
      title: "Logo Tee",
      description: "The classic.",
      url: "https://www.teepublic.com/t-shirt/tee",
      imageUrl: "https://images.example.test/tee.jpg",
      priceLabel: "From $22",
      badge: "New",
      featured: true,
      visible: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Item updated.");
    expect(text()).not.toContain("Edit Merch Item");
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  test("disables New Item at the 48-item limit", async () => {
    const items = Array.from({ length: 48 }, (_, index) =>
      item(`item-${String(index)}`, { sortOrder: index })
    );
    mocks.load.mockResolvedValueOnce(items);
    await render();
    expect(button("New Item").props.disabled).toBe(true);
    expect(text()).toContain("The shop holds 48 items.");

    act(() => renderer?.unmount());
    mocks.load.mockResolvedValueOnce(items.slice(1));
    await render();
    expect(text()).toContain("Item item-1");
    expect(button("New Item").props.disabled).toBe(false);
    expect(text()).not.toContain("The shop holds 48 items.");
  });

  test("keeps the editor and its input when a save fails", async () => {
    mocks.load.mockResolvedValue([]);
    await render();
    await click("New Item");
    type("convex-merch-title", "Logo Tee");
    type("convex-merch-url", "https://www.teepublic.com/t-shirt/1");

    for (const [code, message] of [
      ["VALIDATION_FAILED", "Check the title, links and text lengths."],
      [
        "STALE_CLIENT",
        "This admin client is out of date. Refresh before trying again.",
      ],
    ] as const) {
      mocks.create.mockRejectedValueOnce(
        new ConvexError({ code, message: "Rejected" })
      );
      await click("Save Item");
      expect(toast.error).toHaveBeenLastCalledWith(message);
    }
    expect(button("Save Item").props.disabled).toBe(false);
    const titleField = root().find(
      (node) => node.type === "input" && node.props.id === "convex-merch-title"
    );
    expect(titleField.props.value).toBe("Logo Tee");
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  test("blocks a second action while a write is in flight", async () => {
    mocks.load.mockResolvedValue([item("tee")]);
    let finishCreate: (value: unknown) => void = () => undefined;
    mocks.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCreate = resolve;
      })
    );
    await render();
    await click("New Item");
    type("convex-merch-title", "Logo Tee");
    type("convex-merch-url", `https://www.teepublic.com/${"x".repeat(2048)}`);
    await click("Save Item");
    expect(text()).toContain("The product link must be 2048 characters or fewer.");
    expect(mocks.create).not.toHaveBeenCalled();

    type("convex-merch-url", "https://www.teepublic.com/t-shirt/1");
    await click("Save Item");
    expect(text()).toContain("Saving...");
    expect(button("Saving...").props.disabled).toBe(true);
    expect(button("Cancel").props.disabled).toBe(true);
    for (const label of ["Hide Item tee", "Edit Item tee", "Delete Item tee"]) {
      expect(button(label).props.disabled).toBe(true);
    }
    expect(mocks.create).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCreate(item("new"));
    });
    await act(() => Promise.resolve());
    expect(text()).not.toContain("Saving...");
    expect(button("Hide Item tee").props.disabled).toBe(false);
  });

  test("keeps the order when a move fails", async () => {
    const first = item("first", { sortOrder: 0 });
    const second = item("second", { sortOrder: 1 });
    mocks.load.mockResolvedValue([first, second]);
    mocks.move.mockRejectedValueOnce(
      new ConvexError({ code: "NOT_FOUND", message: "Gone" })
    );
    await render();

    await click("Move Item first down");
    expect(toast.error).toHaveBeenLastCalledWith("That item no longer exists.");
    expect(button("Move Item first up").props.disabled).toBe(true);
    expect(button("Move Item second down").props.disabled).toBe(true);
  });
});
