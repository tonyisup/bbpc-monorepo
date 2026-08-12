import { listEpisodeHistory } from "@/server/convex/episodes";
import { HistoryPageClient } from "./HistoryPageClient";

export default async function HistoryPage() {
  const episodes = await listEpisodeHistory();
  return <HistoryPageClient allEpisodes={episodes} />;
}
