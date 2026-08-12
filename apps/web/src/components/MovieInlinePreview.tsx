"use client";

import Image from "next/image";
import Link from "next/link";
import type { FC } from "react";
import { highlightText, highlightTextByIndices } from "@/utils/text";
import { cn } from "@/lib/utils";
import type { EpisodeMovie } from "@/types/episode";

interface MovieInlinePreviewProps {
  movie: EpisodeMovie;
  searchQuery?: string;
  /** When set (e.g. fuzzy search), highlights Fuse match ranges on the title. */
  titleHighlightIndices?: ReadonlyArray<readonly [number, number]>;
  className?: string; // Applied to container (Link)
  imageClassName?: string; // Applied to Image
  responsive?: boolean;
  priority?: boolean;
  sizes?: string;
}

const MovieInlinePreview: FC<MovieInlinePreviewProps> = ({
  movie,
  searchQuery = "",
  titleHighlightIndices,
  className = "",
  imageClassName = "",
  responsive = false,
  priority = false,
  sizes,
}) => {
  const imageSizes =
    sizes ??
    (responsive
      ? "(max-width: 640px) 48px, 144px"
      : "(max-width: 640px) 96px, 144px");
  const showTitle =
    Boolean(searchQuery) ||
    (titleHighlightIndices !== undefined && titleHighlightIndices.length > 0);
  return (
    <Link
      href={movie.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("flex items-center gap-2 hover:opacity-80", className)}
    >
      {movie.poster && (
        <Image
          className={cn(
            "h-[144px] w-[96px] rounded-2xl md:h-[216px] md:w-[144px]",
            responsive ? "h-[72px] w-[48px] sm:h-[216px] sm:w-[144px]" : "",
            imageClassName
          )}
          src={movie.poster}
          alt={movie.title}
          width={144}
          height={216}
          priority={priority}
          sizes={imageSizes}
        />
      )}
      {showTitle && (
        <div className="text-sm">
          {titleHighlightIndices && titleHighlightIndices.length > 0
            ? highlightTextByIndices(movie.title, titleHighlightIndices)
            : highlightText(movie.title, searchQuery)}
        </div>
      )}
    </Link>
  );
};

export default MovieInlinePreview;
