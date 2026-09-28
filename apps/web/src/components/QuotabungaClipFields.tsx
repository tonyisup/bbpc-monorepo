"use client";

import { useRef, useState } from "react";
import { FullScreenDialog } from "@/components/FullScreenDialog";
import { QuoteClipEditor } from "@/components/QuoteClipEditor";
import {
  QuoteFinderAssistant,
  useAssistantAccess,
} from "@/components/QuoteFinderAssistant";
import { YouTubeVideoSearch } from "@/components/YouTubeVideoSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useYouTubeSearch } from "@/hooks/useYouTubeSearch";
import {
  MAX_CLIP_SECONDS,
  parseYouTubeUrl,
  youtubeWatchUrl,
} from "@/lib/quoteClip";
import type { QuoteLocateRequest } from "@/lib/quoteLocate";
import { cn } from "@/lib/utils";

type Props = {
  clipUrl: string;
  start: string;
  end: string;
  quoteText: string;
  sourceTitle: string;
  sourceType: QuoteLocateRequest["sourceType"];
  onClipUrlChange: (url: string) => void;
  onStartChange: (start: string) => void;
  onEndChange: (end: string) => void;
  onQuoteChange: (quote: string) => void;
  onDurationChange?: (duration: number) => void;
};

/**
 * The finder's search tools. They mount with the dialog, so each opening
 * starts from the form's quote with no stale results.
 */
function FinderSearch({
  suggestedQuery,
  selectedVideoId,
  onSelect,
  ...assistant
}: {
  suggestedQuery: string;
  selectedVideoId?: string;
  onSelect: (url: string) => void;
} & Omit<Parameters<typeof QuoteFinderAssistant>[0], "search">) {
  const search = useYouTubeSearch(suggestedQuery);
  return (
    <>
      <QuoteFinderAssistant search={search} {...assistant} />
      <YouTubeVideoSearch
        search={search}
        selectedVideoId={selectedVideoId}
        onSelect={onSelect}
      />
    </>
  );
}

/** Keep manual entry familiar; open the YouTube tools full screen on request. */
export function QuotabungaClipFields({
  clipUrl,
  start,
  end,
  quoteText,
  sourceTitle,
  sourceType,
  onClipUrlChange,
  onStartChange,
  onEndChange,
  onQuoteChange,
  onDurationChange,
}: Props) {
  const [finderOpen, setFinderOpen] = useState(false);
  // Frozen at open so "Use selected text as quote" doesn't rewrite the search.
  const [finderQuery, setFinderQuery] = useState("");
  // Only a video chosen in this finder session gets a suggested range.
  const [pickedVideoId, setPickedVideoId] = useState<string | null>(null);
  // Bumped per assistant suggestion so the player reloads at its range.
  const [suggestion, setSuggestion] = useState(0);
  const assistant = useAssistantAccess();
  const player = useRef<HTMLDivElement>(null);
  const youtube = parseYouTubeUrl(clipUrl);
  // Once shown, keep End mounted so clearing it doesn't yank focus away.
  const hasEnd = end.trim() !== "";
  const [endShown, setEndShown] = useState(hasEnd);
  if (hasEnd && !endShown) setEndShown(true);

  const openFinder = () => {
    setFinderQuery([sourceTitle, quoteText].filter(Boolean).join(" "));
    setPickedVideoId(null);
    assistant.check();
    setFinderOpen(true);
  };
  const pickClipUrl = (url: string) => {
    const video = parseYouTubeUrl(url);
    if (video) setPickedVideoId(video.id);
    onClipUrlChange(url);
  };
  // The assistant's range replaces the 10-second seed; the form's Submit
  // button stays the confirmation.
  const loadSuggestion = (videoId: string, from: number, to: number) => {
    pickClipUrl(youtubeWatchUrl(videoId));
    onStartChange(String(from));
    onEndChange(String(to));
    setSuggestion((value) => value + 1);
  };

  // The form stays mounted under the dialog, so each copy needs its own ids.
  const clipField = (
    idPrefix: string,
    label: string,
    onChange: (url: string) => void
  ) => (
    <div className="min-w-0 space-y-2">
      <label htmlFor={`${idPrefix}-clip`} className="text-sm font-semibold">
        {label} <span className="font-normal text-gray-500">(optional)</span>
      </label>
      <Input
        id={`${idPrefix}-clip`}
        type="url"
        maxLength={2000}
        value={clipUrl}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://youtube.com/..."
      />
    </div>
  );
  const startField = (idPrefix: string) => (
    <div className="space-y-2">
      <label
        htmlFor={`${idPrefix}-timestamp`}
        className="text-sm font-semibold"
      >
        Start second
      </label>
      <Input
        id={`${idPrefix}-timestamp`}
        type="number"
        min={0}
        max={MAX_CLIP_SECONDS}
        step="any"
        value={start}
        onChange={(event) => onStartChange(event.target.value)}
        placeholder="42"
      />
    </div>
  );
  const endField = (idPrefix: string, markOptional = true) => (
    <div className="space-y-2">
      <label htmlFor={`${idPrefix}-end`} className="text-sm font-semibold">
        End second{" "}
        {markOptional && (
          <span className="font-normal text-gray-500">(optional)</span>
        )}
      </label>
      <Input
        id={`${idPrefix}-end`}
        type="number"
        min={0}
        max={MAX_CLIP_SECONDS}
        step="any"
        value={end}
        onChange={(event) => onEndChange(event.target.value)}
        placeholder="52.5"
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="text-xs text-muted-foreground">
          Need help finding the moment?
        </p>
        <Button
          type="button"
          variant="link"
          className="px-0"
          aria-haspopup="dialog"
          onClick={openFinder}
        >
          Use Quote Finder
        </Button>
      </div>
      <div
        className={cn(
          "grid gap-4",
          endShown
            ? "grid-cols-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]"
            : "sm:grid-cols-[minmax(0,1fr)_10rem]"
        )}
      >
        <div className={cn("min-w-0", endShown && "col-span-2 sm:col-span-1")}>
          {clipField("convex-quotabunga", "Clip link", onClipUrlChange)}
        </div>
        {startField("convex-quotabunga")}
        {endShown && endField("convex-quotabunga", false)}
      </div>

      <FullScreenDialog
        open={finderOpen}
        onOpenChange={setFinderOpen}
        title="Quote Finder"
        description="Your quote and clip times stay in the form."
      >
        <section aria-label="Quote Finder" className="space-y-4">
          <FinderSearch
            suggestedQuery={finderQuery}
            selectedVideoId={youtube?.id}
            onSelect={pickClipUrl}
            access={assistant}
            quoteText={quoteText}
            sourceTitle={sourceTitle}
            sourceType={sourceType}
            hasClip={clipUrl.trim() !== ""}
            loadedVideoId={youtube?.id}
            clipStart={start}
            clipEnd={end}
            onFound={loadSuggestion}
            onUseWording={onQuoteChange}
            onShowPlayer={() => {
              // An explicit smooth scroll would override reduced motion.
              const reduce = window.matchMedia?.(
                "(prefers-reduced-motion: reduce)"
              ).matches;
              player.current?.scrollIntoView({
                behavior: reduce ? "auto" : "smooth",
                block: "start",
              });
              player.current?.focus({ preventScroll: true });
            }}
          />
          {clipField("quote-finder", "Or paste a clip link", pickClipUrl)}
          {youtube && (
            <div
              ref={player}
              tabIndex={-1}
              role="region"
              aria-label="Quote player"
              className="scroll-mt-4 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <QuoteClipEditor
                key={`${youtube.id}:${String(suggestion)}`}
                videoId={youtube.id}
                initialStart={youtube.start}
                seedDefaultRange={pickedVideoId === youtube.id}
                start={start.trim() ? Number(start) : null}
                end={end.trim() ? Number(end) : null}
                onRangeChange={(from, to) => {
                  onStartChange(String(from));
                  onEndChange(String(to));
                }}
                onQuoteChange={onQuoteChange}
                onDurationChange={onDurationChange}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {startField("quote-finder")}
            {endField("quote-finder")}
          </div>
        </section>
      </FullScreenDialog>
    </div>
  );
}
