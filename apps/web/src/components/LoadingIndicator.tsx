import { cn } from "@/lib/utils";

const WAVEFORM_BARS = [
  {
    heightClass: "h-[45%]",
    colorClass: "bg-gradient-to-t from-red-600 to-red-400",
    delayMs: 0,
  },
  {
    heightClass: "h-[78%]",
    colorClass: "bg-gradient-to-t from-red-600 via-red-500 to-orange-400",
    delayMs: 140,
  },
  {
    heightClass: "h-full",
    colorClass: "bg-gradient-to-t from-red-600 via-red-500 to-orange-400",
    delayMs: 280,
  },
  {
    heightClass: "h-[68%]",
    colorClass: "bg-gradient-to-t from-red-600 via-red-500 to-orange-400",
    delayMs: 420,
  },
  {
    heightClass: "h-[40%]",
    colorClass: "bg-gradient-to-t from-red-600 to-red-400",
    delayMs: 560,
  },
] as const;

export type LoadingIndicatorVariant = "page" | "section" | "compact";

function WaveformBars({ compact }: { compact?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex items-center justify-center",
        compact ? "h-4 gap-1" : "h-10 gap-1.5"
      )}
    >
      {WAVEFORM_BARS.map((bar, index) => (
        <span
          key={index}
          className={cn(
            "bbpc-wave-bar rounded-full motion-reduce:animate-none",
            compact ? "w-[3px]" : "w-1.5",
            bar.heightClass,
            bar.colorClass
          )}
          style={{ animationDelay: `${bar.delayMs}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Branded BBPC audio-waveform loading indicator.
 *
 * - `page`: full-width top shimmer progress rail + centered viewport stage so
 *   route transitions hold height and keep the footer from jumping.
 * - `section`: centered in-page waveform for async content panels and searches.
 * - `compact`: inline horizontal waveform and label for tight spaces.
 */
export function LoadingIndicator({
  label = "Loading",
  variant = "section",
  className,
}: {
  label?: string;
  variant?: LoadingIndicatorVariant;
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={cn("inline-flex items-center gap-2.5", className)}
      >
        <WaveformBars compact />
        <span
          aria-hidden="true"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400"
        >
          {label}
        </span>
      </div>
    );
  }

  const centerpiece = (
    <div className="relative flex flex-col items-center gap-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -inset-y-6 rounded-full bg-red-500/15 blur-2xl"
      />
      <WaveformBars />
      <p
        aria-hidden="true"
        className="relative text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400"
      >
        {label}
      </p>
    </div>
  );

  if (variant === "page") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={cn("flex w-full min-w-0 flex-col", className)}
      >
        <div
          aria-hidden="true"
          className="relative h-[2px] w-full overflow-hidden bg-white/[0.06]"
        >
          <div className="bbpc-loading-sweep h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-red-500 to-orange-400/90 shadow-[0_0_12px_rgba(239,68,68,0.75)] motion-reduce:mx-auto motion-reduce:w-1/2 motion-reduce:animate-none motion-reduce:opacity-60" />
        </div>
        <div className="flex min-h-[55vh] w-full flex-col items-center justify-center px-4 py-16">
          {centerpiece}
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        "flex w-full flex-col items-center justify-center px-4 py-16",
        className
      )}
    >
      {centerpiece}
    </div>
  );
}
