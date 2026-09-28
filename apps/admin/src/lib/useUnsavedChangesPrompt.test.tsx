import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  router: { beforePopState: vi.fn() },
}));
vi.mock("next/router", () => ({ useRouter: () => mocks.router }));

import { useUnsavedChangesPrompt } from "./useUnsavedChangesPrompt";

const MESSAGE = "Discard the clip times you haven't saved?";
let view: ReactTestRenderer;
let listeners: Map<string, (event: BeforeUnloadEvent) => void>;
const confirm = vi.fn();
const go = vi.fn();

function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChangesPrompt(dirty, MESSAGE);
  return null;
}

const popGuard = () => {
  const calls = mocks.router.beforePopState.mock.calls;
  return calls[calls.length - 1]?.[0] as () => boolean;
};

describe("unsaved changes prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners = new Map();
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
      confirm,
      history: { go },
    });
  });

  afterEach(() => {
    act(() => view?.unmount());
    vi.unstubAllGlobals();
  });

  test("does nothing while there is nothing to lose", () => {
    act(() => {
      view = create(<Harness dirty={false} />);
    });
    expect(listeners.size).toBe(0);
    expect(mocks.router.beforePopState).not.toHaveBeenCalled();
  });

  test("asks before a reload or closed tab while dirty, and stops once clean", () => {
    act(() => {
      view = create(<Harness dirty />);
    });
    const event = { preventDefault: vi.fn(), returnValue: "x" };
    listeners.get("beforeunload")?.(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");

    act(() => view.update(<Harness dirty={false} />));
    expect(listeners.has("beforeunload")).toBe(false);
    // Back works normally again.
    expect(popGuard()()).toBe(true);
  });

  test("Back asks first, and a refused Back returns to this page", () => {
    act(() => {
      view = create(<Harness dirty />);
    });
    confirm.mockReturnValueOnce(true);
    expect(popGuard()()).toBe(true);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);

    confirm.mockReturnValueOnce(false);
    expect(popGuard()()).toBe(false);
    expect(go).toHaveBeenCalledWith(1);
    // The pop from stepping forward again is ignored without asking.
    expect(popGuard()()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
