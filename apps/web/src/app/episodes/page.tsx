import { Episode } from "@/components/Episode";
import Link from "next/link";
import { listEpisodeHistory } from "@/server/convex/episodes";

async function loadEpisodes() {
  return listEpisodeHistory();
}

export default async function EpisodesPage() {
  const episodes = await loadEpisodes();
  return (
    <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
      <div className="flex w-full max-w-4xl items-center justify-between">
        <h2 className="text-2xl font-bold">All Episodes</h2>
        <Link href="/history" className="text-red-600 hover:text-red-700">
          Search Episodes
        </Link>
      </div>
      <ul className="w-full max-w-4xl">
        {episodes.length === 0 ? (
          <p className="text-center">No episodes available.</p>
        ) : (
          episodes.map((episode) => (
            <li className="mb-8" key={episode.id}>
              <Episode episode={episode} />
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
