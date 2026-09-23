import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import {
  act,
  create,
  type ReactTestInstance,
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

interface DuplicateCheckResult {
  possibleMatch: boolean;
  transcriptMatches?: Array<{
    episodeNumber: number;
    episodeTitle: string;
    episodeSlug: string | null;
    start: number;
    excerpt: string;
  }>;
}

const mocks = vi.hoisted(() => ({
  checkDuplicate: vi.fn<
    (
      client: unknown,
      input: { quoteText: string; sourceTitle: string },
    ) => Promise<DuplicateCheckResult>
  >(),
  convex: {},
  load: vi.fn<() => Promise<unknown>>(),
  submit: vi.fn<() => Promise<void>>(),
  withdraw: vi.fn<() => Promise<void>>(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
}));

vi.mock("@/convex/quotabunga", () => ({
  checkConvexQuotabungaDuplicate: mocks.checkDuplicate,
  loadConvexQuotabunga: mocks.load,
  submitConvexQuotabunga: mocks.submit,
  withdrawConvexQuotabunga: mocks.withdraw,
}));

vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: () => null,
}));

vi.mock("@/components/AdminCollapsibleHeader", () => ({
  AdminCollapsibleHeader: ({
    title,
    description,
  }: {
    title: ReactNode;
    description?: ReactNode;
  }) => (
    <header>
      {title}
      {description}
    </header>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/hooks/useAdminCollapse", () => ({
  useAdminCollapse: () => ({
    headerProps: {},
    isAdminCollapsed: false,
    isContentVisible: true,
  }),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => {
  const Icon = () => <svg />;
  return {
    AlertTriangle: Icon,
    CheckCircle2: Icon,
    ExternalLink: Icon,
    Loader2: Icon,
    Pencil: Icon,
    Trash2: Icon,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { ConvexQuotabungaSubmission } from "@/components/ConvexQuotabungaSubmission";

const openRound = {
  episode: { number: "EP-TEST" },
  isOpen: true,
  submission: null,
};

let renderer: ReactTestRenderer | null = null;

async function renderSubmission() {
  await act(async () => {
    renderer = create(<ConvexQuotabungaSubmission isAdmin={false} />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  if (renderer === null) {
    throw new Error("Quotabunga form did not render.");
  }
  return renderer;
}

function enterQuote(
  rendered: ReactTestRenderer,
  quoteText: string,
  sourceTitle = "Heat",
) {
  act(() => {
    rendered.root
      .findByProps({ id: "convex-quotabunga-quote" })
      .props.onChange({ target: { value: quoteText } });
    rendered.root
      .findByProps({ id: "convex-quotabunga-source" })
      .props.onChange({ target: { value: sourceTitle } });
  });
}

function instanceText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : instanceText(child)))
    .join("");
}

function renderedText(rendered: ReactTestRenderer) {
  return JSON.stringify(rendered.toJSON());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("ConvexQuotabungaSubmission duplicate checks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    mocks.load.mockResolvedValue(openRound);
    mocks.checkDuplicate.mockResolvedValue({ possibleMatch: false });
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("debounces checks, refreshes after 30 seconds, and clears timers", async () => {
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const clearInterval = vi.spyOn(window, "clearInterval");
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(mocks.checkDuplicate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.checkDuplicate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_499);
    });
    expect(mocks.checkDuplicate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.checkDuplicate).toHaveBeenCalledTimes(2);

    act(() => rendered.unmount());
    renderer = null;
    expect(clearTimeout).toHaveBeenCalled();
    expect(clearInterval).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("suppresses a stale duplicate response after the quote changes", async () => {
    const staleCheck = deferred<DuplicateCheckResult>();
    mocks.checkDuplicate
      .mockImplementationOnce(() => staleCheck.promise)
      .mockResolvedValue({ possibleMatch: false });
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.checkDuplicate).toHaveBeenCalledTimes(1);

    enterQuote(rendered, "A completely different quote");
    await act(async () => {
      staleCheck.resolve({ possibleMatch: true });
      await staleCheck.promise;
    });

    expect(renderedText(rendered)).not.toContain("Possible duplicate.");
  });

  test("shows a non-blocking unavailable state when the query rejects", async () => {
    mocks.checkDuplicate.mockRejectedValueOnce(new Error("offline"));
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(renderedText(rendered)).toContain("Couldn't check for duplicates.");
  });

  test("keeps submission enabled while a duplicate warning is visible", async () => {
    mocks.checkDuplicate.mockResolvedValueOnce({ possibleMatch: true });
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(renderedText(rendered)).toContain("Possible duplicate.");
    const submitButton = rendered.root
      .findAllByType("button")
      .find((button) => button.props.type === "submit");
    expect(submitButton?.props.disabled).toBe(false);
  });

  test("lists earlier episodes whose transcripts contain the quote", async () => {
    mocks.checkDuplicate.mockResolvedValueOnce({
      possibleMatch: false,
      transcriptMatches: [
        {
          episodeNumber: 142,
          episodeTitle: "Heat",
          episodeSlug: "heat",
          start: 3723,
          excerpt: "…and he says don't let yourself get attached…",
        },
        {
          episodeNumber: 98,
          episodeTitle: "Unlinked",
          episodeSlug: null,
          start: 65,
          excerpt: "don't let yourself get attached to anything",
        },
      ],
    });
    const rendered = await renderSubmission();
    enterQuote(rendered, "Don't let yourself get attached to anything");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    const text = renderedText(rendered);
    expect(text).toContain("Possibly heard on the show.");
    expect(text).not.toContain("Possible duplicate.");
    expect(text).toContain("1:02:03");
    expect(text).toContain("don't let yourself get attached");
    const liveRegions = rendered.root.findAll(
      (node) => node.type === "p" && node.props.role === "status",
    );
    expect(liveRegions).toHaveLength(1);
    const liveText = liveRegions[0] ? instanceText(liveRegions[0]) : "";
    expect(liveText).toContain("Possibly heard on the show.");
    expect(liveText).not.toContain("attached");
    const links = rendered.root.findAllByType("a");
    expect(links.map((link) => link.props.href)).toEqual(["/episodes/heat"]);
    expect(links[0]?.props.target).toBe("_blank");
    const submitButton = rendered.root
      .findAllByType("button")
      .find((button) => button.props.type === "submit");
    expect(submitButton?.props.disabled).toBe(false);
  });

  test("hides transcript matches once the quote changes", async () => {
    mocks.checkDuplicate
      .mockResolvedValueOnce({
        possibleMatch: false,
        transcriptMatches: [
          {
            episodeNumber: 142,
            episodeTitle: "Heat",
            episodeSlug: "heat",
            start: 10,
            excerpt: "hold on to ya",
          },
        ],
      })
      .mockImplementation(() => new Promise(() => undefined));
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(renderedText(rendered)).toContain("Possibly heard on the show.");

    enterQuote(rendered, "A completely different quote");
    expect(renderedText(rendered)).not.toContain("Possibly heard on the show.");
  });
});
