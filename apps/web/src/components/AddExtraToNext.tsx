"use client";

import { getEpisodeExtrasAddPath } from "@/lib/routes";
import Link from "next/link";
import { type FC } from "react";

import { useBbpcAuth } from "./auth/BbpcAuthContext";
import type { CompleteEpisode } from "./Episode";
import { Button } from "./ui/button";

interface AddExtraToNextProps {
  episode: CompleteEpisode | null;
}

function AddExtraLink({ episode }: { episode: CompleteEpisode }) {
  return (
    <div className="flex w-full items-center justify-center gap-2 p-2">
      <Button variant="outline" asChild>
        <Link
          href={getEpisodeExtrasAddPath(episode.slug ?? episode.id)}
          replace={false}
        >
          Add Extra
        </Link>
      </Button>
    </div>
  );
}

export const AddExtraToNext: FC<AddExtraToNextProps> = ({ episode }) => {
  const { user } = useBbpcAuth();
  if (!episode) return null;
  return user?.isHost === true ? <AddExtraLink episode={episode} /> : null;
};
