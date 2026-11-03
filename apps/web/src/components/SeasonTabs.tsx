import Link from "next/link";

import { SeasonTabLabel } from "@/components/SeasonTabLabel";
import { cn } from "@/lib/utils";

export interface SeasonTab {
  key: string;
  label: string;
  isCurrent: boolean;
  href: string;
}

/** One link per season, as a segmented control that scrolls when it overflows. */
export function SeasonTabs({
  tabs,
  selected,
}: {
  tabs: SeasonTab[];
  selected: string;
}) {
  return (
    <nav aria-label="Seasons" className="max-w-full overflow-x-auto">
      <ul className="inline-flex gap-1 rounded-[10px] border border-white/[0.12] bg-[color:var(--bbpc-surface)] p-1">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={tab.key === selected ? "page" : undefined}
              className={cn(
                "flex h-11 items-center whitespace-nowrap rounded-[7px] px-3.5 text-sm font-semibold text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 lg:h-9",
                tab.key === selected &&
                  "bg-[color:var(--bbpc-surface-raised)] text-white shadow-[inset_0_0_0_1px_var(--bbpc-border)]"
              )}
            >
              <SeasonTabLabel>
                {tab.label}
                {tab.isCurrent && (
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-red-300">
                    Current
                  </span>
                )}
              </SeasonTabLabel>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
