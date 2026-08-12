import { getEpisodePath } from "@/lib/routes";
import type { MetadataRoute } from "next";
import { listEpisodeHistory } from "@/server/convex/episodes";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const episodes = await listEpisodeHistory();

  const episodeEntries = episodes.map((episode) => ({
    url: `https://badboyspodcast.com${getEpisodePath(
      episode.slug ?? episode.id
    )}`,
    lastModified: new Date(),
  }));

  return [
    {
      url: "https://badboyspodcast.com",
      lastModified: new Date(),
    },
    ...episodeEntries,
  ];
}
