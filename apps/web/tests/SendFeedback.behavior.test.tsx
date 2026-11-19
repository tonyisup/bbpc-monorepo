import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  convex: {},
  pathname: "/history" as string | null,
  submit: vi.fn<(client: unknown, input: unknown) => Promise<unknown>>(),
  errorCode: vi.fn<(error: unknown) => string | null>(() => null),
  signIn: vi.fn(),
  auth: {
    accountStatus: "ready",
    user: { name: "Listener" } as null | { name: string },
  },
}));

vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({ ...mocks.auth, signIn: mocks.signIn }),
}));
vi.mock("@/convex/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/convex/feedback")>()),
  submitConvexFeedback: mocks.submit,
}));
vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: { feedback: { member: { submit: "submit" } } },
}));
vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: mocks.errorCode,
}));
vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));
vi.mock("lucide-react", () => {
  const Icon = () => <svg />;
  return {
    Bug: Icon,
    CheckCircle2: Icon,
    Lightbulb: Icon,
    Loader2: Icon,
    MessageSquare: Icon,
    MessageSquarePlus: Icon,
    Sparkles: Icon,
  };
});
// Radix portals need a DOM; these stand-ins render an open dialog in place.
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: ({ children, open }: { children?: ReactNode; open: boolean }) =>
      open ? <div data-dialog="open">{children}</div> : null,
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
  };
});

import { SendFeedback } from "@/components/SendFeedback";

let renderer: ReactTestRenderer | null = null;

function root(): ReactTestInstance {
  if (renderer === null) throw new Error("Expected a render");
  return renderer.root;
}

function strings(node: ReactTestInstance | string): string[] {
  return typeof node === "string" ? [node] : node.children.flatMap(strings);
}

function text(): string {
  return strings(root()).join("");
}

function button(label: string): ReactTestInstance {
  const match = root()
    .findAllByType("button")
    .find((node) => strings(node).join("").includes(label));
  if (match === undefined) throw new Error(`Expected a ${label} button`);
  return match;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    (button(label).props as { onClick: () => void }).onClick();
  });
}

function typeMessage(value: string): void {
  const field = root().findByType("textarea");
  act(() => {
    (field.props as { onChange: (event: unknown) => void }).onChange({
      target: { value },
    });
  });
}

async function submitForm(): Promise<void> {
  const form = root().findByType("form");
  await act(async () => {
    (form.props as { onSubmit: (event: unknown) => void }).onSubmit({
      preventDefault: () => undefined,
    });
  });
  await act(() => Promise.resolve());
}

function render(): void {
  act(() => {
    renderer = create(<SendFeedback />);
  });
}

beforeEach(() => {
  mocks.pathname = "/history";
  mocks.auth = { accountStatus: "ready", user: { name: "Listener" } };
});

afterEach(() => {
  if (renderer !== null) {
    act(() => renderer?.unmount());
    renderer = null;
  }
  vi.resetAllMocks();
});

describe("send feedback", () => {
  test("asks signed-out visitors to sign in", async () => {
    mocks.auth = { accountStatus: "not-applicable", user: null };
    render();

    expect(text()).toContain("Sign in to send feedback");
    await click("Sign in to send feedback");
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(root().findAllByType("form")).toHaveLength(0);
  });

  test("sends a categorized message with the current page", async () => {
    mocks.submit.mockResolvedValue({ id: "feedback-1", createdAt: 1 });
    render();

    await click("Send feedback");
    expect(text()).toContain("Sent from /history");
    const send = () =>
      root()
        .findAllByType("button")
        .find((node) => node.props.type === "submit");
    expect(send()?.props.disabled).toBe(true);

    await click("Bug");
    expect(button("Bug").props["aria-pressed"]).toBe(true);
    typeMessage("  The player skips on iOS.  ");
    expect(send()?.props.disabled).toBe(false);
    await submitForm();

    expect(mocks.submit).toHaveBeenCalledWith(mocks.convex, {
      category: "bug",
      message: "  The player skips on iOS.  ",
      pagePath: "/history",
    });
    expect(text()).toContain("Thanks for the feedback");

    await click("Send more");
    expect(root().findByType("textarea").props.value).toBe("");
  });

  test("files uncategorized feedback as other and sends with the keyboard", async () => {
    mocks.submit.mockResolvedValue({ id: "feedback-1", createdAt: 1 });
    mocks.pathname = null;
    render();

    await click("Send feedback");
    expect(text()).not.toContain("Sent from");
    typeMessage("Love the new standings page");
    const field = root().findByType("textarea");
    await act(async () => {
      (field.props as { onKeyDown: (event: unknown) => void }).onKeyDown({
        key: "Enter",
        metaKey: true,
        ctrlKey: false,
        preventDefault: () => undefined,
      });
    });
    await act(() => Promise.resolve());

    expect(mocks.submit).toHaveBeenCalledWith(mocks.convex, {
      category: "other",
      message: "Love the new standings page",
      pagePath: null,
    });
  });

  test("keeps the draft and explains a rate limit", async () => {
    mocks.submit.mockRejectedValue(new Error("limited"));
    mocks.errorCode.mockReturnValue("CONFLICT");
    render();

    await click("Send feedback");
    typeMessage("One more thing");
    await submitForm();

    expect(text()).toContain("You've sent a lot of feedback in the last hour");
    expect(root().findByType("textarea").props.value).toBe("One more thing");
  });

  test("blocks messages over the limit", async () => {
    render();
    await click("Send feedback");
    typeMessage("x".repeat(2001));

    expect(text()).toContain("2001/2000");
    expect(root().findByType("textarea").props["aria-invalid"]).toBe(true);
    await submitForm();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
