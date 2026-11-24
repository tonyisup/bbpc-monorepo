"use client";

import Image from "next/image";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { getMovieLink } from "@/utils/movieLinks";

/** A poster that opens the movie's page (IMDb or TMDB, per the profile) in a new tab. */
export function MoviePosterLink({
  movie,
  width,
  height,
}: {
  movie: {
    title: string;
    poster: string | null;
    url: string;
    tmdbId: number | null;
  };
  width: number;
  height: number;
}) {
  const { user } = useBbpcAuth();
  const size = { width: `${String(width)}px`, height: `${String(height)}px` };
  return (
    <a
      href={getMovieLink(movie, user?.movieLinkPreference)}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${movie.title} in a new tab`}
      className="block flex-shrink-0 overflow-hidden rounded transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-amber-400"
      style={size}
    >
      {movie.poster ? (
        <Image
          src={movie.poster}
          alt=""
          width={width}
          height={height}
          sizes={`${String(width)}px`}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="block h-full w-full bg-zinc-800" />
      )}
    </a>
  );
}
