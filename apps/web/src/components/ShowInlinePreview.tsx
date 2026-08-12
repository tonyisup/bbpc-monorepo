"use client";

import Image from "next/image";
import Link from "next/link";
import type { FC } from "react";
import { highlightText, highlightTextByIndices } from "@/utils/text";
import { cn } from "@/lib/utils";
import type { EpisodeShow } from "@/types/episode";

interface ShowInlinePreviewProps {
  show: EpisodeShow;
  searchQuery?: string;
  titleHighlightIndices?: ReadonlyArray<readonly [number, number]>;
  className?: string; // Applied to container (Link)
  imageClassName?: string; // Applied to Image
  responsive?: boolean;
}

const ShowInlinePreview: FC<ShowInlinePreviewProps> = ({
  show,
  searchQuery = "",
  titleHighlightIndices,
  className = "",
  imageClassName = "",
  responsive = false,
}) => {
  const showTitle =
    Boolean(searchQuery) ||
    (titleHighlightIndices !== undefined && titleHighlightIndices.length > 0);
  return (
    <Link
      href={show.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("flex items-center gap-2 hover:opacity-80", className)}
    >
      {show.poster && (
        <Image
          className={cn(
            "h-[72px] w-[48px] rounded-2xl sm:h-[216px] sm:w-[144px]",
            responsive ? "h-[72px] w-[48px] sm:h-[216px] sm:w-[144px]" : "",
            imageClassName
          )}
          src={show.poster}
          alt={show.title}
          width={144}
          height={216}
          priority={false}
          sizes="(max-width: 640px) 48px, 144px"
        />
      )}
      {showTitle && (
        <div className="text-sm">
          {titleHighlightIndices && titleHighlightIndices.length > 0
            ? highlightTextByIndices(show.title, titleHighlightIndices)
            : highlightText(show.title, searchQuery)}
        </div>
      )}
    </Link>
  );
};

export default ShowInlinePreview;
