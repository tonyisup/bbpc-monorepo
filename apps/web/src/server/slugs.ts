import { isUuid, UUID_PATTERN } from "@/lib/ids";
import {
  getEpisodeByLegacyId,
  getEpisodeBySlug,
} from "@/server/convex/episodes";

export { isUuid, UUID_PATTERN };

export async function resolveEpisodeRouteParam(slugOrId: string) {
  const episode =
    (await getEpisodeBySlug(slugOrId)) ??
    (isUuid(slugOrId) ? await getEpisodeByLegacyId(slugOrId) : null);

  return {
    episode,
    shouldRedirect:
      !!episode?.slug && isUuid(slugOrId) && episode.slug !== slugOrId,
  };
}
