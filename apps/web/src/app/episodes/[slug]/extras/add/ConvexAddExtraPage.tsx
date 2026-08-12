import { notFound, permanentRedirect } from "next/navigation";

import { isUuid } from "@/lib/ids";
import { getEpisodeExtrasAddPath } from "@/lib/routes";
import {
  getEpisodeByLegacyId,
  getEpisodeBySlug,
} from "@/server/convex/episodes";

import { ConvexAddExtraPageClient } from "./ConvexAddExtraPageClient";

export async function ConvexAddExtraPage({ slug }: { slug: string }) {
  const episode =
    (await getEpisodeBySlug(slug)) ??
    (isUuid(slug) ? await getEpisodeByLegacyId(slug) : null);

  if (!episode) {
    notFound();
  }

  if (episode.slug && isUuid(slug) && episode.slug !== slug) {
    permanentRedirect(getEpisodeExtrasAddPath(episode.slug));
  }

  return (
    <ConvexAddExtraPageClient
      episodeId={episode.id}
      episodeSlug={episode.slug ?? null}
    />
  );
}
