import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A small poster thumbnail. Without a poster it keeps the same footprint so
 * rows stay aligned. The title is always shown beside it, so the image is
 * decorative.
 */
export function MoviePoster({
  poster,
  className,
}: {
  poster: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-14 w-10 flex-shrink-0 overflow-hidden rounded bg-zinc-800 shadow-lg",
        className
      )}
      aria-hidden="true"
    >
      {poster !== null && (
        <Image src={poster} alt="" fill sizes="56px" className="object-cover" />
      )}
    </div>
  );
}
