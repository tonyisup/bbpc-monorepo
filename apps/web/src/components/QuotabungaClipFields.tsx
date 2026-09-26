"use client";

import { useState } from "react";
import { FullScreenDialog } from "@/components/FullScreenDialog";
import { QuoteClipEditor } from "@/components/QuoteClipEditor";
import { YouTubeVideoSearch } from "@/components/YouTubeVideoSearch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CLIP_SECONDS, parseYouTubeUrl } from "@/lib/quoteClip";
import { cn } from "@/lib/utils";

type Props = {
  clipUrl: string;
  start: string;
  end: string;
  suggestedQuery: string;
  onClipUrlChange: (url: string) => void;
  onStartChange: (start: string) => void;
  onEndChange: (end: string) => void;
  onQuoteChange: (quote: string) => void;
  onDurationChange?: (duration: number) => void;
};

/** Keep manual entry familiar; open the YouTube tools full screen on request. */
export function QuotabungaClipFields({
  clipUrl,
  start,
  end,
  suggestedQuery,
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
  const youtube = parseYouTubeUrl(clipUrl);
  // Once shown, keep End mounted so clearing it doesn't yank focus away.
  const hasEnd = end.trim() !== "";
  const [endShown, setEndShown] = useState(hasEnd);
  if (hasEnd && !endShown) setEndShown(true);

  const openFinder = () => {
    setFinderQuery(suggestedQuery);
    setPickedVideoId(null);
    setFinderOpen(true);
  };
  const pickClipUrl = (url: string) => {
    const video = parseYouTubeUrl(url);
    if (video) setPickedVideoId(video.id);
    onClipUrlChange(url);
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
          <YouTubeVideoSearch
            suggestedQuery={finderQuery}
            selectedVideoId={youtube?.id}
            onSelect={pickClipUrl}
          />
          {clipField("quote-finder", "Or paste a clip link", pickClipUrl)}
          {youtube && (
            <QuoteClipEditor
              key={youtube.id}
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
