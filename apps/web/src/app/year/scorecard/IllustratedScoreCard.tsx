"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  SCORECARD_CRITERIA,
  SCORECARD_MAX_SCORE,
  SCORECARD_MIN_SCORE,
} from "@/lib/scorecard";
import {
  scorecardIllustrationCaption,
  scorecardIllustrationSrc,
} from "@/lib/scorecard-illustrations";

import {
  ScoreCardActions,
  ScoreCardHeader,
  type ScoreCardProps,
} from "./ScoreCard";
import { ScoreSlider } from "./ScoreSlider";

const SCORES = Array.from(
  { length: SCORECARD_MAX_SCORE - SCORECARD_MIN_SCORE + 1 },
  (_, index) => SCORECARD_MIN_SCORE + index
);

/**
 * One criterion at a time, with a picture of what the score means above the
 * slider. The picture follows the slider while dragging; the score saves on
 * release, exactly as in the list view.
 */
export function IllustratedScoreCard(props: ScoreCardProps) {
  const { movie, scores, busy, onCommit } = props;
  const [step, setStep] = useState(() => {
    const firstUnscored = SCORECARD_CRITERIA.findIndex(
      (criterion) => scores[criterion.key] === undefined
    );
    return firstUnscored === -1 ? 0 : firstUnscored;
  });
  const [preview, setPreview] = useState<number | null>(null);
  const criterion = SCORECARD_CRITERIA[step] ?? SCORECARD_CRITERIA[0];
  const shown = preview ?? scores[criterion.key];
  const next = SCORECARD_CRITERIA[step + 1];

  // Warm this criterion's ten images (and the next one's) so dragging swaps instantly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    for (const key of [criterion.key, next?.key]) {
      if (!key) continue;
      for (const score of SCORES) {
        const image = new window.Image();
        image.src = scorecardIllustrationSrc(key, score);
      }
    }
  }, [criterion.key, next?.key]);

  const sectionRef = useRef<HTMLElement>(null);
  const pictureRef = useRef<HTMLElement>(null);
  const reserved = useReservedHeight(sectionRef, pictureRef);

  const goToStep = (index: number) => {
    setPreview(null);
    setStep(index);
  };

  return (
    <section
      ref={sectionRef}
      aria-label={`Score ${movie.title}`}
      className="space-y-3"
    >
      <ScoreCardHeader {...props} />

      <nav aria-label="Criteria" className="grid grid-cols-9 gap-1">
        {SCORECARD_CRITERIA.map((item, index) => {
          const value = scores[item.key];
          return (
            <button
              key={item.key}
              type="button"
              aria-current={index === step ? "step" : undefined}
              aria-label={`${item.label}: ${
                value === undefined ? "not scored" : String(value)
              }`}
              onClick={() => goToStep(index)}
              className={`flex min-h-11 flex-col items-center justify-center rounded tabular-nums leading-tight ${
                index === step
                  ? "bg-amber-400 text-zinc-950"
                  : value === undefined
                  ? "border border-dashed border-zinc-700 text-muted-foreground"
                  : "bg-zinc-800 text-zinc-100"
              }`}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">
                {item.label.slice(0, 3)}
              </span>
              <span className="text-sm font-black">{value ?? "–"}</span>
            </button>
          );
        })}
      </nav>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-xl font-black">
            {criterion.label}
          </h3>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {step + 1} of {SCORECARD_CRITERIA.length}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-11 p-0"
              disabled={step === 0}
              onClick={() => goToStep(step - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only">Back</span>
            </Button>
            {next && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 px-3"
                onClick={() => goToStep(step + 1)}
              >
                Next: {next.label}
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{criterion.hint}</p>
      </div>

      {/* Sized to the room left on screen so the whole card fits without scrolling. */}
      <figure
        ref={pictureRef}
        className="relative mx-auto aspect-[672/496] w-full overflow-hidden rounded-lg bg-zinc-900"
        style={{ maxWidth: pictureMaxWidth(reserved) }}
      >
        {shown === undefined ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-zinc-700 p-6 text-center text-sm text-muted-foreground">
            Drag the slider to see what each score looks like.
          </div>
        ) : (
          <Image
            src={scorecardIllustrationSrc(criterion.key, shown)}
            alt={scorecardIllustrationCaption(criterion.key, shown)}
            width={672}
            height={496}
            sizes="(max-width: 672px) 100vw, 672px"
            unoptimized
            className="h-full w-full object-cover"
          />
        )}
        <figcaption
          className={`absolute inset-x-0 bottom-0 flex items-baseline gap-2 px-3 pb-2 pt-6 sm:pt-8 ${
            shown === undefined
              ? ""
              : "bg-gradient-to-t from-black/90 via-black/70 to-transparent"
          }`}
          aria-live="polite"
        >
          {shown !== undefined && (
            <>
              <span className="text-xl font-black tabular-nums text-amber-400 sm:text-2xl">
                {shown}
              </span>
              <span className="text-xs text-white sm:text-sm">
                {scorecardIllustrationCaption(criterion.key, shown)}
              </span>
            </>
          )}
        </figcaption>
      </figure>

      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[10px] text-muted-foreground">
          {SCORECARD_MIN_SCORE}
        </span>
        <div className="min-w-0 flex-1">
          <ScoreSlider
            key={criterion.key}
            label={criterion.label}
            value={scores[criterion.key]}
            disabled={busy}
            onCommit={(value) => onCommit(criterion.key, value)}
            onPreview={setPreview}
          />
        </div>
        <span aria-hidden className="text-[10px] text-muted-foreground">
          {SCORECARD_MAX_SCORE}
        </span>
      </div>

      <ScoreCardActions {...props} />
    </section>
  );
}

/** Never shrink the picture below this height; a very short screen scrolls instead. */
const MIN_PICTURE_HEIGHT = "10rem";
/** Room kept below the card so its last row is not flush with the screen edge. */
const BOTTOM_GAP = 16;

function pictureMaxWidth(reserved: number | null) {
  const height =
    reserved === null
      ? "40svh"
      : `max(${MIN_PICTURE_HEIGHT}, 100svh - ${String(reserved)}px)`;
  return `min(672px, calc(${height} * 672 / 496))`;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * How much of the screen's height the card needs besides the picture: the
 * page above it plus the card's other rows. The picture gets the rest, via
 * svh in CSS, so it does not jump as a phone's address bar shows and hides.
 */
function useReservedHeight(
  sectionRef: RefObject<HTMLElement>,
  pictureRef: RefObject<HTMLElement>
) {
  const [reserved, setReserved] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const section = sectionRef.current;
    const picture = pictureRef.current;
    if (!section || !picture) return;
    const measure = () => {
      const box = section.getBoundingClientRect();
      const top = box.top + window.scrollY;
      const others = box.height - picture.getBoundingClientRect().height;
      setReserved(Math.ceil(top + others + BOTTOM_GAP));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(section);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [sectionRef, pictureRef]);

  return reserved;
}
