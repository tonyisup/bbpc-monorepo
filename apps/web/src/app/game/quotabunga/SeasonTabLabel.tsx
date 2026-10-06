"use client";

import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The inside of a season tab. Changing season keeps the old one on screen
 * until the new one arrives, so the tapped tab pulses while it loads.
 */
export function SeasonTabLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cn(
        "flex items-center gap-1.5",
        pending && "animate-pulse motion-reduce:animate-none"
      )}
    >
      {children}
      {pending && <span className="sr-only"> (loading)</span>}
    </span>
  );
}
