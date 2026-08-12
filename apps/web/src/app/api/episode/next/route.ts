import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getNextScheduledEpisode } from "@/server/convex/episodes";

interface WebhookResponse {
  fulfillmentMessages: Array<{
    text: {
      text: string[];
    };
  }>;
}

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

async function loadNextEpisode() {
  return getNextScheduledEpisode();
}

export async function GET() {
  try {
    const episode = await loadNextEpisode();

    if (!episode) {
      return NextResponse.json({ error: "No episodes found." }, { status: 404 });
    }

    // Build structured data for movies
    const movieList: StructuredData = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: episode.assignments.map((assignment, index) => {
        const movie = assignment.movie;

        const structuredMovie: StructuredMovie = {
          "@type": "Movie",
          name: movie.title,
          url: movie.url,
          image: movie.poster || undefined,
          dateCreated: movie.year ? `${movie.year}-01-01` : undefined,
          director: {
            "@type": "Person",
            name: "Unknown Director" // We don't have director info in the current schema
          }
        };

        return {
          "@type": "ListItem",
          position: index + 1,
          item: structuredMovie
        };
      })
    };

    return NextResponse.json(movieList);
  } catch (error) {
    console.error("Error fetching episode data:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await req.json();
    const episode = await loadNextEpisode();

    if (!episode) {
      const response: WebhookResponse = {
        fulfillmentMessages: [{
          text: {
            text: ["No episodes found."]
          }
        }]
      };
      return NextResponse.json(response);
    }

    const response: WebhookResponse = {
      fulfillmentMessages: [{
        text: {
          text: [
            `Movies assigned: ${episode.assignments.map(a => a.movie.title).join(" and ")}`
          ]
        }
      }]
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error processing webhook:", error);
    const errorResponse: WebhookResponse = {
      fulfillmentMessages: [{
        text: {
          text: ["Sorry, I encountered an error while fetching episode information."]
        }
      }]
    };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}
