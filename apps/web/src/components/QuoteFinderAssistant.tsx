"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { YouTubeSearch } from "@/hooks/useYouTubeSearch";
import { formatClipTime } from "@/lib/quoteClip";
import {
  MAX_ASSISTANT_VIDEO_SECONDS,
  MAX_LOCATE_CANDIDATES,
  QUOTE_LOCATE_UNAVAILABLE,
  quoteLocateAvailabilitySchema,
  quoteLocateErrorSchema,
  quoteLocateResponseSchema,
  type QuoteLocateRequest,
  type QuoteLocateResponse,
} from "@/lib/quoteLocate";
import { cn } from "@/lib/utils";

const LOCATE_URL = "/api/quote-finder/locate";

/** A message that is safe and specific enough to show the listener. */
class AssistantError extends Error {}

type Found = Extract<QuoteLocateResponse, { status: "found" }>;
type Missed = Extract<QuoteLocateResponse, { status: "not_found" }>;

type Phase =
  | { kind: "idle"; note?: string }
  | { kind: "searching" }
  | { kind: "listening" }
  // `loaded` is false while a suggestion waits to replace the listener's clip.
  | { kind: "found"; result: Found; loaded: boolean }
  | { kind: "missed"; result: Missed }
  // `retry` holds the videos a failed check was given, to try again.
  | { kind: "error"; message: string; retry: string[] | null };

/** What the assistant remembers for the page, across openings of the finder. */
type AssistantMemory = {
  // The listener's own wording and source. Every run looks for them, and
  // Restore brings the wording back after they use a heard line.
  quote: string | null;
  source: string | null;
  // The heard line the listener put in the form, if any.
  applied: string | null;
  // The assistant's last suggestion in the player and the range it set,
  // which it may replace until the listener changes them.
  suggested: string | null;
  suggestedRange: { start: string; end: string } | null;
  // Videos already checked or that can't be checked; no later run pays for
  // them again.
  excluded: Set<string>;
};

function missMessage(result: Missed) {
  const title = result.video ? `“${result.video.title}”` : "";
  switch (result.reason) {
    case "not_heard":
      return `Didn't hear the line in ${title}.`;
    case "unreadable":
      return `Couldn't listen to ${title}.`;
    case "timeout":
      return `${title} took too long to check.`;
    case "no_candidates":
      return `None of these videos can be checked. The assistant only listens to public videos up to ${String(
        MAX_ASSISTANT_VIDEO_SECONDS / 60
      )} minutes long.`;
  }
}

/**
 * The assistant's page-wide state. The finder asks whether to offer it the
 * first time it opens; an answer that isn't definite (a sign-in hiccup, a
 * network error) is asked again on the next open. A refusal that retrying
 * won't fix holds across openings, until its retry time if it has one, and
 * so does what the assistant has already checked.
 */
export function useAssistantAccess() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [refusal, setRefusal] = useState<{
    reason: string;
    until: number | null;
  } | null>(null);
  const memory = useRef<AssistantMemory>({
    quote: null,
    source: null,
    applied: null,
    suggested: null,
    suggestedRange: null,
    excluded: new Set(),
  });
  const asked = useRef(false);
  const check = useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    fetch(LOCATE_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error("Availability unknown");
        return quoteLocateAvailabilitySchema.parse(await response.json());
      })
      .then((body) => setAvailable(body.available))
      .catch(() => {
        asked.current = false;
      });
  }, []);
  const disable = useCallback(
    (reason: string, retryAfterSeconds: number | null) =>
      setRefusal({
        reason,
        until:
          retryAfterSeconds === null
            ? null
            : Date.now() + retryAfterSeconds * 1000,
      }),
    []
  );
  // Lift a refusal when its retry time passes, even if nothing else renders.
  useEffect(() => {
    if (refusal?.until == null) return;
    const timer = setTimeout(
      () => setRefusal(null),
      Math.max(0, refusal.until - Date.now())
    );
    return () => clearTimeout(timer);
  }, [refusal]);
  const disabledReason =
    refusal && (refusal.until === null || Date.now() < refusal.until)
      ? refusal.reason
      : null;
  return { available, disabledReason, check, disable, memory };
}

export type AssistantAccess = ReturnType<typeof useAssistantAccess>;

/**
 * "Find it for me": searches (or reuses the search results), asks the locate
 * route to listen to one video at a time, and loads its suggestion into the
 * quote player. Nothing is submitted; the listener previews and decides.
 */
export function QuoteFinderAssistant({
  access,
  search,
  quoteText,
  sourceTitle,
  sourceType,
  hasClip,
  loadedVideoId,
  clipStart,
  clipEnd,
  onFound,
  onUseWording,
  onShowPlayer,
}: {
  access: AssistantAccess;
  search: YouTubeSearch;
  quoteText: string;
  sourceTitle: string;
  sourceType: QuoteLocateRequest["sourceType"];
  /** Whether the form already holds a clip link. */
  hasClip: boolean;
  /** The video in the quote player, however it got there. */
  loadedVideoId?: string;
  /** The form's clip times, to tell a suggestion the listener has edited. */
  clipStart?: string;
  clipEnd?: string;
  onFound: (videoId: string, start: number, end: number) => void;
  onUseWording: (text: string) => void;
  onShowPlayer?: () => void;
}) {
  const { disabledReason } = access;
  const memory = access.memory.current;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // A short confirmation added to the status line, e.g. after Restore.
  const [notice, setNotice] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  // What the panel showed before a run: its buttons stay in place, disabled,
  // while the run goes on, and Cancel returns to it.
  const beforeRun = useRef<Phase>({ kind: "idle" });
  const section = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const moveFocus = useRef(false);
  // Read when an answer arrives, which can be long after the press.
  const clip = useRef({ hasClip, loadedVideoId, clipStart, clipEnd });
  clip.current = { hasClip, loadedVideoId, clipStart, clipEnd };
  const ready = quoteText.trim() !== "" && sourceTitle.trim() !== "";
  const busy = phase.kind === "searching" || phase.kind === "listening";

  useEffect(() => () => request.current?.abort(), []);

  // Another video was loaded by hand; the heard line no longer applies.
  useEffect(() => {
    setPhase((current) =>
      current.kind === "found" &&
      current.loaded &&
      current.result.video.id !== loadedVideoId
        ? { kind: "idle" }
        : current
    );
  }, [loadedVideoId]);

  // A pressed button is often gone after the press, so the status line takes
  // focus, unless the listener moved on while the run went on. It runs before
  // paint, ahead of the dialog's own focus handling.
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    const active =
      typeof document === "undefined" ? null : document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      active.getAttribute("role") === "dialog";
    if (!lost && !section.current?.contains(active)) {
      moveFocus.current = false;
      return;
    }
    statusRef.current?.focus();
    if (phase.kind !== "searching" && phase.kind !== "listening")
      moveFocus.current = false;
  }, [phase, notice]);

  function loadSuggestion(result: Found) {
    memory.suggested = result.video.id;
    memory.suggestedRange = {
      start: String(result.start),
      end: String(result.end),
    };
    onFound(result.video.id, result.start, result.end);
    // Make room for the quote player, where the listener checks it.
    search.setResultsOpen(false);
  }

  async function locate(videoIds: string[], controller: AbortController) {
    const batch = videoIds.slice(0, MAX_LOCATE_CANDIDATES);
    setPhase({ kind: "listening" });
    try {
      const response = await fetch(LOCATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteText: memory.quote ?? quoteText.trim(),
          sourceTitle: sourceTitle.trim(),
          sourceType,
          videoIds: batch,
        } satisfies QuoteLocateRequest),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = quoteLocateErrorSchema.safeParse(
          await response.json().catch(() => null)
        );
        if (body.success && body.data.disabled) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          access.disable(
            body.data.error,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
          );
        }
        throw new AssistantError(
          body.success ? body.data.error : QUOTE_LOCATE_UNAVAILABLE
        );
      }
      const result = quoteLocateResponseSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      // The route checked one video and skipped those it can't check; only
      // `remaining`, and a video that timed out, are still worth a run.
      for (const id of batch)
        if (
          !result.remaining.includes(id) &&
          !(
            result.status === "not_found" &&
            result.reason === "timeout" &&
            result.video?.id === id
          )
        )
          memory.excluded.add(id);
      if (result.status === "not_found") {
        setPhase({ kind: "missed", result });
        return;
      }
      // Replace the assistant's own suggestion freely, but not a clip the
      // listener chose or a suggestion whose times they changed.
      const { hasClip: holdsClip, loadedVideoId: inPlayer } = clip.current;
      const edited =
        clip.current.clipStart !== undefined &&
        (clip.current.clipStart !== memory.suggestedRange?.start ||
          clip.current.clipEnd !== memory.suggestedRange?.end);
      const loaded =
        !holdsClip ||
        (memory.suggested !== null && inPlayer === memory.suggested && !edited);
      if (loaded) loadSuggestion(result);
      setPhase({ kind: "found", result, loaded });
    } catch (error) {
      if (controller.signal.aborted) return;
      setPhase({
        kind: "error",
        message:
          error instanceof AssistantError
            ? error.message
            : QUOTE_LOCATE_UNAVAILABLE,
        retry: batch,
      });
    }
  }

  function start(run: (controller: AbortController) => Promise<void>) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    beforeRun.current = phase;
    moveFocus.current = true;
    setNotice(null);
    void run(controller);
  }

  async function findIt(controller: AbortController) {
    const quote = quoteText.trim();
    const source = sourceTitle.trim();
    // A changed quote or source starts over; a heard line the listener used
    // keeps their own wording.
    if (
      memory.quote === null ||
      memory.source !== source ||
      (quote !== memory.quote && quote !== memory.applied)
    ) {
      memory.quote = quote;
      memory.source = source;
      memory.applied = null;
      memory.excluded = new Set();
    }
    const listed = search.results;
    let videos =
      listed && !listed.loading && !listed.error ? listed.videos : null;
    if (!videos) {
      setPhase({ kind: "searching" });
      const outcome = await search.search();
      if (controller.signal.aborted) return;
      if (outcome === "replaced") {
        // The listener is typing a new search; don't pull them away.
        moveFocus.current = false;
        setPhase({
          kind: "idle",
          note: "The search changed. Press Find it for me to check the new results.",
        });
        return;
      }
      if (!outcome) {
        setPhase({
          kind: "error",
          message: search.valid
            ? "The video search didn't finish. See the note under Find a video."
            : "Type a search under Find a video first.",
          retry: null,
        });
        return;
      }
      videos = outcome;
    }
    const fresh = videos
      .map((video) => video.id)
      .filter((id) => !memory.excluded.has(id));
    if (fresh.length === 0) {
      setPhase({
        kind: "error",
        message:
          videos.length === 0
            ? "The search found no videos. Try the movie title or a shorter part of the quote below."
            : "Every video in this search has been checked. Try another search below.",
        retry: null,
      });
      return;
    }
    await locate(fresh, controller);
  }

  function cancel() {
    request.current?.abort();
    moveFocus.current = true;
    const before = beforeRun.current;
    // A suggestion replaced by hand during the run is no longer loaded.
    const stale =
      before.kind === "found" &&
      before.loaded &&
      before.result.video.id !== clip.current.loadedVideoId;
    setPhase(
      (before.kind === "found" && !stale) ||
        before.kind === "missed" ||
        before.kind === "error"
        ? before
        : { kind: "idle", note: "Stopped. Nothing new was loaded." }
    );
  }

  function restore(focus: boolean) {
    if (memory.quote === null) return;
    onUseWording(memory.quote);
    memory.applied = null;
    moveFocus.current = focus;
    setNotice("Your own wording is back in the form.");
  }

  if (access.available !== true) return null;

  // While a run goes on, the buttons of the panel before it stay in place.
  const view = busy ? beforeRun.current : phase;
  const found = view.kind === "found" ? view : null;
  const missed = view.kind === "missed" ? view.result : null;
  const settled =
    search.results && !search.results.loading && !search.results.error
      ? search.results
      : null;
  const timedOut =
    missed?.reason === "timeout" && missed.video ? missed.video.id : null;
  // The route's leftovers first, then listed videos this session hasn't
  // checked, including those of a newer search.
  const remaining = found?.result.remaining ?? missed?.remaining ?? [];
  const next = [
    ...remaining,
    ...(settled?.videos ?? [])
      .map((video) => video.id)
      .filter((id) => !memory.excluded.has(id) && !remaining.includes(id)),
  ].filter((id) => id !== timedOut);
  const quote = quoteText.trim();
  const heard = found?.result.spokenText ?? null;
  const matchesOriginal = heard !== null && memory.quote === heard;
  const wordsDiffer =
    heard !== null && heard !== memory.quote && heard !== quote;
  const restorable =
    memory.applied !== null &&
    quote === memory.applied &&
    memory.quote !== null &&
    memory.quote !== memory.applied;
  const possible = found?.result.match === "possible";
  const unsure = wordsDiffer
    ? "the words don’t quite match your quote"
    : "the assistant isn’t sure it’s the line";

  const checkButton = (videoIds: string[], label: string) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => start((controller) => locate(videoIds, controller))}
    >
      {label}
    </Button>
  );

  // One status line stays mounted so screen readers hear each change.
  let status: ReactNode = null;
  let warn = false;
  if (!ready)
    status =
      "Close the Quote Finder, add your quote and the movie or show to the form, then open it again.";
  else if (phase.kind === "searching") status = "Finding videos to check…";
  else if (phase.kind === "listening")
    status = "Listening for the line… This usually takes a few seconds.";
  else if (found)
    status = (
      <>
        {possible ? "Might be in" : "Heard in"} “{found.result.video.title}” at{" "}
        <span className="font-mono tabular-nums">
          {formatClipTime(found.result.start)}–
          {formatClipTime(found.result.end)}
        </span>
        .{" "}
        {found.loaded
          ? possible
            ? `It’s loaded in the quote player below, but ${unsure}. Play it to check.`
            : "It’s loaded in the quote player below."
          : possible
          ? `Load it to replace the clip in your form, but ${unsure}. Play it to check.`
          : "Load it to replace the clip in your form."}
        {matchesOriginal
          ? " It matches your quote."
          : quote === heard
          ? " Your quote now uses this wording."
          : ""}
      </>
    );
  else if (missed)
    status = `${missMessage(missed)}${
      memory.suggested !== null && loadedVideoId === memory.suggested
        ? " The earlier suggestion is still in the quote player."
        : ""
    }`;
  else if (disabledReason !== null || phase.kind === "error") {
    status = disabledReason ?? (phase.kind === "error" ? phase.message : null);
    warn = true;
  } else if (phase.kind === "idle" && phase.note) status = phase.note;
  if (ready && notice && !busy)
    status = (
      <>
        {status}
        {status === null ? "" : " "}
        {notice}
      </>
    );

  return (
    <section
      ref={section}
      aria-label="Quote Finder assistant"
      className="space-y-3 rounded-lg border border-primary/40 bg-card p-4"
    >
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          Find it for me
        </h3>
        <p className="text-xs text-muted-foreground">
          Searches YouTube for your quote and listens for the line in one video
          at a time. Play the suggestion before you submit.
        </p>
      </div>

      <p
        ref={statusRef}
        tabIndex={-1}
        aria-live="polite"
        className={cn(
          "rounded-sm text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
          // Empty, it stays in the accessibility tree as a live region.
          status === null && "sr-only",
          !busy && (warn || possible)
            ? "text-amber-200"
            : (busy || !found) && "text-muted-foreground"
        )}
      >
        {status}
      </p>

      {ready && found && (
        <blockquote className="border-l-2 border-primary pl-3 text-sm">
          “{found.result.spokenText}”
        </blockquote>
      )}

      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          {found && !found.loaded && disabledReason === null && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                moveFocus.current = true;
                loadSuggestion(found.result);
                setPhase({ ...found, loaded: true });
              }}
            >
              Load it
            </Button>
          )}
          {found?.loaded && onShowPlayer && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={onShowPlayer}
            >
              Show player
            </Button>
          )}
          {found?.loaded &&
            !matchesOriginal &&
            (quote !== heard || restorable) && (
              // One button that swaps its job keeps keyboard focus in place.
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (quote === heard) restore(false);
                  else {
                    setNotice(null);
                    memory.applied = found.result.spokenText;
                    onUseWording(found.result.spokenText);
                  }
                }}
              >
                {quote === heard ? "Restore my wording" : "Use exact wording"}
              </Button>
            )}
          {/* An earlier heard line can still be in the form. */}
          {restorable && !(found?.loaded && quote === heard) && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => restore(true)}
            >
              Restore my wording
            </Button>
          )}
          {disabledReason !== null ? null : found || missed ? (
            <>
              {timedOut && checkButton([timedOut, ...remaining], "Try again")}
              {next.length > 0 &&
                checkButton(
                  next,
                  found ? "Not it, try the next video" : "Try the next video"
                )}
            </>
          ) : view.kind === "error" && view.retry ? (
            checkButton(view.retry, "Try again")
          ) : (
            <Button
              type="button"
              size="sm"
              // Wait for a search the listener started; its results are next.
              disabled={busy || search.results?.loading === true}
              onClick={() => start(findIt)}
            >
              <Sparkles aria-hidden="true" />
              Find it for me
            </Button>
          )}
          {/* Last in the row, so a double press lands on the disabled button
              instead of cancelling the run it just paid for. */}
          {busy && (
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {ready &&
        !busy &&
        (found || missed) &&
        next.length === 0 &&
        !timedOut && (
          <p className="text-xs text-muted-foreground">
            No more videos to check from this search. Try another search below,
            or pick a video yourself.
          </p>
        )}
    </section>
  );
}
