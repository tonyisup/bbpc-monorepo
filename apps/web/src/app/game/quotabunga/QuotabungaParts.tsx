import {
  listenerName,
  placementLabel,
  sourceLabel,
} from "@/lib/quotabungaArchive";
import { cn } from "@/lib/utils";
import type { QuotabungaEntry } from "@/types/quotabunga";

export function PlaceBadge({ placement }: { placement: 1 | 2 | 3 }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold",
        placement === 1
          ? "border-red-500/40 bg-[color:var(--bbpc-accent-soft)] text-red-300"
          : "border-white/[0.12] text-zinc-300"
      )}
    >
      {placementLabel(placement)}
    </span>
  );
}

/** "Jaws · ReelTalkRob": where the quote is from and who sent it in. */
export function EntryByline({
  entry,
  className,
}: {
  entry: QuotabungaEntry;
  className?: string;
}) {
  return (
    <p className={cn("break-words text-[13px] text-zinc-400", className)}>
      {sourceLabel(entry)} ·{" "}
      <span className="font-semibold text-zinc-200">
        {listenerName(entry.user.name)}
      </span>
    </p>
  );
}
