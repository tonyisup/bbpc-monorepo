"use client";

// PROTOTYPE ONLY: floating variant switcher for throwaway UI prototypes.
// Lives on a prototype branch; never merge to main.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";

export function PrototypeSwitcher({
  variants,
}: {
  variants: Array<{ key: string; name: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentKey = searchParams.get("variant") ?? variants[0]?.key ?? "A";
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === currentKey)
  );
  const current = variants[index];

  const go = useCallback(
    (step: number) => {
      const next = variants[(index + step + variants.length) % variants.length];
      if (!next) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", next.key);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [index, pathname, router, searchParams, variants]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (process.env.NODE_ENV === "production" || !current) return null;

  return (
    <div className="fixed left-1/2 top-[4.25rem] z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-400 bg-black/90 px-1 py-1 text-xs font-semibold text-fuchsia-200 shadow-2xl">
      <button
        type="button"
        aria-label="Previous variant"
        className="rounded-full p-1.5 hover:bg-fuchsia-500/20"
        onClick={() => go(-1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="px-1 whitespace-nowrap">
        PROTOTYPE {current.key} · {current.name}
      </span>
      <button
        type="button"
        aria-label="Next variant"
        className="rounded-full p-1.5 hover:bg-fuchsia-500/20"
        onClick={() => go(1)}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
