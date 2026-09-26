import { useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@radix-ui/react-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Root: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: ReactNode;
    }) =>
      open ? (
        <div role="dialog">
          <button aria-label="Close" onClick={() => onOpenChange(false)} />
          {children}
        </div>
      ) : null,
    Portal: Pass,
    Content: Pass,
    Title: Pass,
    Description: Pass,
    Close: Pass,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import { FullScreenDialog } from "@/components/FullScreenDialog";

/** Same-document history: back() moves one entry and fires popstate. */
function fakeWindow() {
  const entries: unknown[] = [{ __NA: true }];
  let index = 0;
  const listeners = new Set<() => void>();
  return {
    history: {
      get state() {
        return entries[index];
      },
      get length() {
        return entries.length;
      },
      pushState: vi.fn((state: unknown) => {
        entries.splice(index + 1);
        entries.push(state);
        index += 1;
      }),
      back: vi.fn(() => {
        if (index === 0) return;
        index -= 1;
        listeners.forEach((listener) => listener());
      }),
    },
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  };
}

let win: ReturnType<typeof fakeWindow>;
let view: ReactTestRenderer;
let setOpen: (open: boolean) => void;

function Harness() {
  const [open, setOpenState] = useState(false);
  setOpen = setOpenState;
  return (
    <FullScreenDialog
      open={open}
      onOpenChange={setOpenState}
      title="Quote Finder"
      description="Your quote and clip times stay in the form."
    >
      <p>Tools</p>
    </FullScreenDialog>
  );
}

function render() {
  act(() => {
    view = create(<Harness />);
  });
}

const isOpen = () => view.root.findAllByProps({ role: "dialog" }).length > 0;

describe("FullScreenDialog history", () => {
  beforeEach(() => {
    win = fakeWindow();
    vi.stubGlobal("window", win);
  });

  afterEach(() => {
    act(() => view.unmount());
    vi.unstubAllGlobals();
  });

  const close = () =>
    act(() => view.root.findByProps({ "aria-label": "Close" }).props.onClick());

  test("the back gesture closes the dialog without leaving the page", () => {
    render();
    act(() => setOpen(true));
    expect(win.history.pushState).toHaveBeenCalledTimes(1);
    expect(isOpen()).toBe(true);

    act(() => win.history.back());
    expect(isOpen()).toBe(false);
    expect(win.history.back).toHaveBeenCalledTimes(1);
    expect(win.history.state).toEqual({ __NA: true });
  });

  test("Done steps back over its own entry", () => {
    render();
    act(() => setOpen(true));
    close();
    expect(isOpen()).toBe(false);
    expect(win.history.back).toHaveBeenCalledTimes(1);
    expect(win.history.state).toEqual({ __NA: true });
  });

  test("reopening replaces the old entry instead of stacking", () => {
    render();
    act(() => setOpen(true));
    close();
    act(() => setOpen(true));
    expect(isOpen()).toBe(true);
    expect(win.history.length).toBe(2);
    close();
    expect(win.history.state).toEqual({ __NA: true });
  });
});
