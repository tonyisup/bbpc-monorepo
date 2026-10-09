import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The single surface the listener game sits on. Its parts are rows divided by
 * hairlines rather than boxes inside boxes. It clips instead of hiding
 * overflow so the rating legend can stay pinned while the page scrolls.
 */
export function GameSheet({
  className,
  children,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-white/10 bg-black/20 supports-[overflow:clip]:overflow-clip",
        className
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function GameSheetHeader({
  title,
  children,
}: {
  title: ReactNode;
  /** Round status, shown beside the title. */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 pb-4 pt-5 sm:px-6">
      <div>
        <p className="bbpc-kicker">Listener game</p>
        <h2 className="mt-0.5 text-xl font-extrabold leading-tight text-white sm:text-[1.375rem]">
          {title}
        </h2>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-zinc-400">
          {children}
        </div>
      ) : null}
    </header>
  );
}

/** A one-message row: sign-in, empty and error states all share it. */
export function GameSheetRow({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "border-t border-white/10 px-4 py-4 text-sm sm:px-6",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
