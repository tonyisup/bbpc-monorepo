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
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  checkDuplicate:
    vi.fn<
      (
        client: unknown,
        input: { quoteText: string; sourceTitle: string }
      ) => Promise<DuplicateCheckResult>
    >(),
  convex: {},
  errorCode: vi.fn<(error: unknown) => string | null>(() => null),
  load: vi.fn<() => Promise<unknown>>(),
  submit: vi.fn<() => Promise<void>>(),
  withdraw: vi.fn<() => Promise<void>>(),
  editor: null as null | {
    videoId: string;
    start: number | null;
    end: number | null;
    onRangeChange: (start: number, end: number) => void;
    onQuoteChange: (text: string) => void;
    onDurationChange?: (duration: number) => void;
  },
  window: undefined as
    | { status: string | null; closesAt: number | null }
    | null
    | undefined,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children?: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("convex/react", () => ({
  useConvex: () => mocks.convex,
  useQuery: () => mocks.window,
}));

vi.mock("@/convex/quotabunga", () => ({
  checkConvexQuotabungaDuplicate: mocks.checkDuplicate,
  loadConvexQuotabunga: mocks.load,
  submitConvexQuotabunga: mocks.submit,
  withdrawConvexQuotabunga: mocks.withdraw,
}));

vi.mock("@/convex/identity", () => ({
  getConvexDomainErrorCode: (error: unknown) => mocks.errorCode(error),
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

import { toast } from "sonner";

import { ConvexQuotabungaSubmission } from "@/components/ConvexQuotabungaSubmission";

vi.mock("@/components/QuoteClipEditor", () => ({
  QuoteClipEditor: (props: NonNullable<typeof mocks.editor>) => {
    mocks.editor = props;
    return <div>Quote player</div>;
  },
}));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("@/components/FullScreenDialog", () => ({
  FullScreenDialog: ({
    open,
    onOpenChange,
    title,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    children: ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Done
        </button>
        {children}
      </div>
    ) : null,
}));

const openRound = {
  episode: { id: "episode-test", number: "EP-TEST", status: "next" },
  isOpen: true,
  submission: null,
};

let renderer: ReactTestRenderer | null = null;

async function renderSubmission(episodeStatus = "next") {
  await act(async () => {
    renderer = create(
      <ConvexQuotabungaSubmission
        isAdmin={false}
        episodeId="episode-test"
        episodeStatus={episodeStatus}
      />
    );
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
  sourceTitle = "Heat"
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
    mocks.window = undefined;
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
      (node) => node.type === "p" && node.props.role === "status"
    );
    expect(liveRegions).toHaveLength(1);
    const liveText = liveRegions[0] ? instanceText(liveRegions[0]) : "";
    expect(liveText).toContain("Possibly heard on the show.");
    expect(liveText).not.toContain("attached");
    const links = rendered.root
      .findAllByType("a")
      .filter((link) => link.props.href.startsWith("/episodes/"));
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

describe("ConvexQuotabungaSubmission round window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.stubGlobal("window", globalThis);
    mocks.window = undefined;
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

  test("keeps the form open during the recording grace period with a countdown", async () => {
    mocks.load.mockResolvedValue({
      ...openRound,
      episode: { ...openRound.episode, status: "recording" },
    });
    mocks.window = { status: "recording", closesAt: 100_000 + 90_000 };
    const rendered = await renderSubmission();
    expect(renderedText(rendered)).toContain(
      "Entries lock with the picks in 1:30"
    );
    expect(
      rendered.root.findAllByProps(
        { id: "convex-quotabunga-quote" },
        { deep: false }
      )
    ).toHaveLength(1);
  });

  test("locks the form when the countdown reaches the deadline", async () => {
    mocks.load.mockResolvedValue({
      ...openRound,
      episode: { ...openRound.episode, status: "recording" },
    });
    mocks.window = { status: "recording", closesAt: 100_000 + 90_000 };
    const rendered = await renderSubmission("recording");
    expect(renderedText(rendered)).toContain(
      "Entries lock with the picks in 1:30"
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    const text = renderedText(rendered);
    expect(text).toContain("are locked");
    expect(text).not.toContain("Entries lock with the picks");
    expect(
      rendered.root.findAllByProps(
        { id: "convex-quotabunga-quote" },
        { deep: false }
      )
    ).toHaveLength(0);
  });

  test("locks once the prediction deadline passes even if the load said open", async () => {
    mocks.load.mockResolvedValue({
      ...openRound,
      episode: { ...openRound.episode, status: "recording" },
    });
    mocks.window = { status: "recording", closesAt: 100_000 - 1 };
    const rendered = await renderSubmission();
    expect(renderedText(rendered)).toContain("are locked");
    expect(
      rendered.root.findAllByProps(
        { id: "convex-quotabunga-quote" },
        { deep: false }
      )
    ).toHaveLength(0);
  });

  test("shows an aired episode's entry as final without edit controls", async () => {
    mocks.load.mockResolvedValue({
      ...openRound,
      episode: { ...openRound.episode, status: "published" },
      isOpen: false,
      submission: {
        id: "quote-1",
        quoteText: "Hold on to ya",
        sourceTitle: "Heat",
        sourceType: "MOVIE",
        clipUrl: null,
        clipStartSeconds: null,
        listenerNotes: null,
        status: "INCLUDED",
        bracketOrder: null,
        placement: null,
        scored: false,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mocks.window = { status: "published", closesAt: null };
    const rendered = await renderSubmission("published");
    const text = renderedText(rendered);
    expect(text).toContain("Hold on to ya");
    expect(text).toContain("This episode has aired");
    expect(text).not.toContain("Submit to Quotabunga");
    expect(
      rendered.root.findAllByType("button").map((b) => instanceText(b))
    ).not.toContain("Withdraw");
    expect(mocks.load).toHaveBeenCalledWith(mocks.convex, "episode-test");
  });

  test("closes the form on an aired episode without an entry", async () => {
    mocks.load.mockResolvedValue({
      ...openRound,
      episode: { ...openRound.episode, status: "published" },
      isOpen: false,
    });
    mocks.window = { status: "published", closesAt: null };
    const rendered = await renderSubmission("published");
    expect(renderedText(rendered)).toContain("are closed");
    expect(renderedText(rendered)).toContain("Submit to the current round");
    expect(
      rendered.root.findAllByProps(
        { id: "convex-quotabunga-quote" },
        { deep: false }
      )
    ).toHaveLength(0);
  });

  test("locks a submitted entry's edit controls when the window closes", async () => {
    mocks.load.mockResolvedValue({
      ...openRound,
      episode: { ...openRound.episode, status: "recording" },
      submission: {
        id: "quote-1",
        quoteText: "Hold on to ya",
        sourceTitle: "Heat",
        sourceType: "MOVIE",
        clipUrl: null,
        clipStartSeconds: null,
        listenerNotes: null,
        status: "SUBMITTED",
        bracketOrder: null,
        placement: null,
        scored: false,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mocks.window = { status: "recording", closesAt: 100_000 - 1 };
    const rendered = await renderSubmission();
    expect(renderedText(rendered)).toContain("locked for recording");
    expect(
      rendered.root.findAllByType("button").map((b) => instanceText(b))
    ).not.toContain("Withdraw");
  });
});

const savedEntry = {
  id: "quote-1",
  quoteText: "Hold on to ya",
  sourceTitle: "Heat",
  sourceType: "MOVIE",
  clipUrl: null,
  clipStartSeconds: null,
  listenerNotes: null,
  status: "SUBMITTED",
  bracketOrder: null,
  placement: null,
  scored: false,
  createdAt: 1,
  updatedAt: 1,
};

async function submitForm(rendered: ReactTestRenderer) {
  await act(async () => {
    await rendered.root.findByType("form").props.onSubmit({
      preventDefault: vi.fn(),
    });
  });
}

function findButton(rendered: ReactTestRenderer, label: string) {
  const button = rendered.root
    .findAllByType("button")
    .find((candidate) => instanceText(candidate) === label);
  if (button === undefined) {
    throw new Error(`No ${label} button rendered.`);
  }
  return button;
}

describe("ConvexQuotabungaSubmission writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    mocks.window = undefined;
    mocks.errorCode.mockReturnValue(null);
    mocks.load.mockResolvedValue(openRound);
    mocks.submit.mockResolvedValue(undefined);
    mocks.withdraw.mockResolvedValue(undefined);
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

  test("opens the Quote Finder full screen and returns to the simple fields", async () => {
    const rendered = await renderSubmission();
    expect(
      rendered.root.findAllByProps({ id: "convex-quotabunga-end" })
    ).toHaveLength(0);
    expect(rendered.root.findAllByProps({ role: "dialog" })).toHaveLength(0);

    act(() => findButton(rendered, "Use Quote Finder").props.onClick());
    expect(
      rendered.root.findAllByProps({
        role: "dialog",
        "aria-label": "Quote Finder",
      })
    ).toHaveLength(1);
    rendered.root.findByProps({ id: "quote-finder-clip" });
    rendered.root.findByProps({ id: "quote-finder-end" });
    findButton(rendered, "Search");

    act(() => {
      rendered.root
        .findByProps({ id: "quote-finder-timestamp" })
        .props.onChange({ target: { value: "12" } });
      rendered.root
        .findByProps({ id: "quote-finder-end" })
        .props.onChange({ target: { value: "18.5" } });
    });
    act(() => findButton(rendered, "Done").props.onClick());
    expect(rendered.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(
      rendered.root.findByProps({ id: "convex-quotabunga-timestamp" }).props
        .value
    ).toBe("12");
    expect(
      rendered.root.findByProps({ id: "convex-quotabunga-end" }).props.value
    ).toBe("18.5");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  test("choosing a searched video fills the link, resets old timing and preserves quote text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            videos: [
              { id: "lmnopqrstuv", title: "Another scene", channel: "Movies" },
            ],
            nextPageToken: null,
          })
        )
      )
    );
    const rendered = await renderSubmission();
    enterQuote(rendered, "Keep these words", "Heat");
    act(() => findButton(rendered, "Use Quote Finder").props.onClick());
    act(() => {
      rendered.root
        .findByProps({ id: "quote-finder-clip" })
        .props.onChange({ target: { value: "https://youtu.be/abcdefghijk" } });
    });
    act(() => {
      rendered.root
        .findByProps({ id: "quote-finder-timestamp" })
        .props.onChange({ target: { value: "42" } });
      rendered.root
        .findByProps({ id: "quote-finder-end" })
        .props.onChange({ target: { value: "52" } });
    });
    await act(async () => {
      findButton(rendered, "Search").props.onClick();
    });
    act(() =>
      rendered.root
        .findByProps({ "aria-label": "Use video: Another scene" })
        .props.onClick()
    );
    expect(
      rendered.root.findByProps({ id: "quote-finder-clip" }).props.value
    ).toBe("https://www.youtube.com/watch?v=lmnopqrstuv");
    expect(
      rendered.root.findByProps({ id: "convex-quotabunga-clip" }).props.value
    ).toBe("https://www.youtube.com/watch?v=lmnopqrstuv");
    expect(
      rendered.root.findByProps({ id: "quote-finder-timestamp" }).props.value
    ).toBe("0");
    expect(
      rendered.root.findByProps({ id: "quote-finder-end" }).props.value
    ).toBe("");
    expect(
      rendered.root.findByProps({ id: "convex-quotabunga-quote" }).props.value
    ).toBe("Keep these words");
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  test("submits a fractional range from the Quote Finder and refuses ranges that are reversed, past the video or missing a link", async () => {
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya", "Heat");
    act(() => findButton(rendered, "Use Quote Finder").props.onClick());
    expect(
      rendered.root.findByProps({ "aria-label": "Search YouTube videos" }).props
        .value
    ).toBe("Heat Hold on to ya");
    const field = (id: string) => rendered.root.findByProps({ id });
    const change = (id: string, value: string) =>
      act(() => field(id).props.onChange({ target: { value } }));
    const expectRefused = async () => {
      await submitForm(rendered);
      expect(mocks.submit).not.toHaveBeenCalled();
      expect(renderedText(rendered)).toContain(
        "Clip times must be between 0 and 86400 seconds"
      );
    };

    change("quote-finder-timestamp", "5");
    change("quote-finder-end", "8");
    await expectRefused();
    expect(renderedText(rendered)).toContain("and a clip link");

    change("quote-finder-clip", "https://youtu.be/abcdefghijk?t=12");
    expect(field("quote-finder-timestamp").props.value).toBe("12");
    expect(field("quote-finder-end").props.value).toBe("");
    expect(mocks.editor?.videoId).toBe("abcdefghijk");
    act(() => mocks.editor?.onDurationChange?.(20));
    act(() => mocks.editor?.onRangeChange(12.5, 18.25));
    expect(field("quote-finder-timestamp").props.value).toBe("12.5");
    expect(field("quote-finder-end").props.value).toBe("18.25");
    expect(mocks.editor).toMatchObject({ start: 12.5, end: 18.25 });

    change("quote-finder-end", "21");
    await expectRefused();
    change("quote-finder-end", "11");
    await expectRefused();
    change("quote-finder-end", "");
    change("quote-finder-timestamp", "20");
    await expectRefused();

    change("quote-finder-timestamp", "12.5");
    change("quote-finder-end", "18.25");
    act(() => mocks.editor?.onQuoteChange("Hold on to ya, man"));
    expect(field("convex-quotabunga-quote").props.value).toBe(
      "Hold on to ya, man"
    );
    await submitForm(rendered);
    expect(mocks.submit).toHaveBeenCalledWith(
      mocks.convex,
      "episode-test",
      expect.objectContaining({
        quoteText: "Hold on to ya, man",
        // Saved as a watch link that opens at the chosen start for hosts.
        clipUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=12s",
        clipStartSeconds: 12.5,
        clipEndSeconds: 18.25,
      })
    );
  });

  test("shows and restores a saved range, and entries saved before end times still edit and submit", async () => {
    const edit = (rendered: ReactTestRenderer) =>
      act(() =>
        rendered.root
          .findAllByType("button")
          .find((button) => instanceText(button).trim() === "Edit")!
          .props.onClick()
      );
    mocks.load.mockResolvedValue({
      ...openRound,
      submission: {
        ...savedEntry,
        clipUrl: "https://youtu.be/abcdefghijk",
        clipStartSeconds: 42.125,
        clipEndSeconds: 52.5,
      },
    });
    let rendered = await renderSubmission();
    expect(renderedText(rendered)).toContain(" · 0:42.1");
    expect(renderedText(rendered)).toContain(" – 0:52.5");
    edit(rendered);
    expect(
      rendered.root.findByProps({ id: "convex-quotabunga-timestamp" }).props
        .value
    ).toBe("42.125");
    expect(
      rendered.root.findByProps({ id: "convex-quotabunga-end" }).props.value
    ).toBe("52.5");
    // Clearing a saved end sends an explicit null so the backend drops it,
    // and the End field stays put while it is being cleared.
    act(() =>
      rendered.root
        .findByProps({ id: "convex-quotabunga-end" })
        .props.onChange({ target: { value: "" } })
    );
    rendered.root.findByProps({ id: "convex-quotabunga-end" });
    await submitForm(rendered);
    expect(mocks.submit).toHaveBeenLastCalledWith(
      mocks.convex,
      "episode-test",
      expect.objectContaining({
        clipStartSeconds: 42.125,
        clipEndSeconds: null,
      })
    );
    act(() => rendered.unmount());
    mocks.submit.mockClear();

    // savedEntry has no clipEndSeconds, like rows written before this change.
    mocks.load.mockResolvedValue({
      ...openRound,
      submission: {
        ...savedEntry,
        clipUrl: "https://example.test/clip",
        clipStartSeconds: 42,
      },
    });
    rendered = await renderSubmission();
    expect(renderedText(rendered)).toContain(" · 0:42.0");
    expect(renderedText(rendered)).not.toContain(" – ");
    edit(rendered);
    expect(
      rendered.root.findAllByProps({ id: "convex-quotabunga-end" })
    ).toHaveLength(0);
    await submitForm(rendered);
    expect(mocks.submit).toHaveBeenCalledWith(
      mocks.convex,
      "episode-test",
      expect.objectContaining({
        clipUrl: "https://example.test/clip",
        clipStartSeconds: 42,
      })
    );
    // With no end to set or clear, the argument is left out so a backend
    // without clip ranges still accepts the write.
    expect(
      (mocks.submit.mock.calls.at(-1) as unknown[] | undefined)?.[2]
    ).not.toHaveProperty("clipEndSeconds");
  });

  test("keeps times when the same video is relinked or the link moves to another host", async () => {
    const rendered = await renderSubmission();
    act(() => findButton(rendered, "Use Quote Finder").props.onClick());
    const field = (id: string) => rendered.root.findByProps({ id });
    const change = (id: string, value: string) =>
      act(() => field(id).props.onChange({ target: { value } }));
    const times = () => [
      field("quote-finder-timestamp").props.value,
      field("quote-finder-end").props.value,
    ];
    change("quote-finder-clip", "https://youtu.be/abcdefghijk?t=12");
    change("quote-finder-end", "18");
    // Same moment in another URL form, or a bare link, keeps the times.
    change(
      "quote-finder-clip",
      "https://www.youtube.com/watch?v=abcdefghijk&t=12"
    );
    change("quote-finder-clip", "https://youtu.be/abcdefghijk");
    expect(times()).toEqual(["12", "18"]);
    // A half-typed time parses as 0 and must not disturb anything either.
    change("quote-finder-clip", "https://youtu.be/abcdefghijk?t=1x");
    change("quote-finder-clip", "https://youtu.be/abcdefghijk?t=12");
    expect(times()).toEqual(["12", "18"]);
    change("quote-finder-clip", "https://example.test/clip");
    expect(times()).toEqual(["12", "18"]);
    expect(renderedText(rendered)).not.toContain("Quote player");
    // Switching to a different video is what resets the times.
    change("quote-finder-clip", "https://youtu.be/lmnopqrstuv");
    expect(times()).toEqual(["0", ""]);
  });

  test("the time fields stay the source of truth for the same video", async () => {
    const rendered = await renderSubmission();
    act(() => findButton(rendered, "Use Quote Finder").props.onClick());
    const field = (id: string) => rendered.root.findByProps({ id });
    const change = (id: string, value: string) =>
      act(() => field(id).props.onChange({ target: { value } }));
    change("quote-finder-clip", "https://youtu.be/abcdefghijk?t=12");
    change("quote-finder-timestamp", "12.5");
    change("quote-finder-end", "18");
    // Deleting a timestamp one key at a time passes through t=1.
    for (const value of [
      "https://youtu.be/abcdefghijk?t=1",
      "https://youtu.be/abcdefghijk?t=30",
      "https://youtu.be/abcdefghijk",
    ])
      change("quote-finder-clip", value);
    expect(field("quote-finder-timestamp").props.value).toBe("12.5");
    expect(field("quote-finder-end").props.value).toBe("18");
  });

  test("keeps a typed start while a clip link is typed or edited", async () => {
    const rendered = await renderSubmission();
    const field = (id: string) => rendered.root.findByProps({ id });
    const change = (id: string, value: string) =>
      act(() => field(id).props.onChange({ target: { value } }));
    change("convex-quotabunga-timestamp", "42");
    for (const value of ["h", "https://vimeo.com/1", "https://vimeo.com/12"])
      change("convex-quotabunga-clip", value);
    expect(field("convex-quotabunga-timestamp").props.value).toBe("42");
    // A bare YouTube link keeps it too, and half-typed edits don't reset it.
    change("convex-quotabunga-clip", "https://youtu.be/abcdefghijk");
    change("convex-quotabunga-clip", "https://youtu.be/abcdefghij");
    change("convex-quotabunga-clip", "https://youtu.be/abcdefghijk");
    expect(field("convex-quotabunga-timestamp").props.value).toBe("42");
  });

  test("submits the entry for this episode and reloads it", async () => {
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya", "Heat");
    await submitForm(rendered);
    expect(mocks.submit).toHaveBeenCalledWith(
      mocks.convex,
      "episode-test",
      expect.objectContaining({
        quoteText: "Hold on to ya",
        sourceTitle: "Heat",
        sourceType: "MOVIE",
        clipUrl: null,
        clipStartSeconds: null,
        listenerNotes: null,
      })
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  test("refuses an empty entry without calling the backend", async () => {
    const rendered = await renderSubmission();
    await submitForm(rendered);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(renderedText(rendered)).toContain("Add a quote and source");
  });

  test("reloads the round after a locked-round conflict", async () => {
    mocks.submit.mockRejectedValue(new Error("locked"));
    mocks.errorCode.mockReturnValue("CONFLICT");
    const rendered = await renderSubmission();
    enterQuote(rendered, "Hold on to ya", "Heat");
    await submitForm(rendered);
    // The reload clears the inline message; the toast carries it.
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("This round was locked or changed")
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  test("withdraws this episode's entry after the member confirms", async () => {
    mocks.load.mockResolvedValue({ ...openRound, submission: savedEntry });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
    const rendered = await renderSubmission();
    await act(async () => {
      await findButton(rendered, "Withdraw").props.onClick();
    });
    expect(mocks.withdraw).toHaveBeenCalledWith(mocks.convex, "episode-test");
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  test("keeps the entry when the member declines the confirmation", async () => {
    mocks.load.mockResolvedValue({ ...openRound, submission: savedEntry });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false)
    );
    const rendered = await renderSubmission();
    await act(async () => {
      await findButton(rendered, "Withdraw").props.onClick();
    });
    expect(mocks.withdraw).not.toHaveBeenCalled();
    expect(renderedText(rendered)).toContain("Hold on to ya");
  });
});
