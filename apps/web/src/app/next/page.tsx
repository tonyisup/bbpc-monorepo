import { type Metadata } from "next";
import { Episode } from "@/components/Episode";
import { getNextScheduledEpisode } from "@/server/convex/episodes";

// Structured data types for schema.org
interface StructuredMovie {
  "@type": "Movie";
  name: string;
  url?: string;
  image?: string;
  dateCreated?: string;
  director?: {
    "@type": "Person";
    name: string;
  };
  review?: {
    "@type": "Review";
    reviewRating: {
      "@type": "Rating";
      ratingValue: number;
    };
    author: {
      "@type": "Person";
      name: string;
    };
  };
  aggregateRating?: {
    "@type": "AggregateRating";
    ratingValue: number;
    bestRating: number;
    ratingCount: number;
  };
}

interface StructuredData {
  "@context": "https://schema.org";
  "@type": "ItemList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    item: StructuredMovie;
  }>;
}

export const metadata: Metadata = {
  title: "Movie Assignments for Next Episode",
  description: "Movie assignments for the next episode of the show",
};

async function loadNextEpisode() {
  return getNextScheduledEpisode();
}

export default async function NextPage() {
  const nextEpisode = await loadNextEpisode();
  let movieList: StructuredData | undefined;

  if (nextEpisode) {
    // Build structured data for movies
    movieList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: nextEpisode.assignments.map((assignment, index) => {
        const movie = assignment.movie;

        const structuredMovie: StructuredMovie = {
          "@type": "Movie",
          name: movie.title,
          url: movie.url,
          image: movie.poster || undefined,
          dateCreated: movie.year ? `${movie.year}-01-01` : undefined,
        };

        return {
          "@type": "ListItem",
          position: index + 1,
          item: structuredMovie,
        };
      }),
    };
  }
  return (
    <div>
      <h1>Movie Assignments for Next Episode</h1>

      {movieList && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(movieList),
          }}
        />
      )}
      {nextEpisode && <Episode episode={nextEpisode} allowGuesses={true} />}
    </div>
  );
}
