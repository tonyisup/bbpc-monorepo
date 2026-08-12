import Head from "next/head";
import Link from "next/link";
import {
  ChevronLeft,
  Film,
  Star,
  ExternalLink,
  User,
  Mic2,
  Tv,
} from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import Image from "next/image";
import RatingIcon from "../Review/RatingIcon";
import { FC } from "react";
import { formatInstantLocal, formatPlainDate } from "@/lib/dates";
import { getAdminEpisodePath } from "@/lib/routes";

interface MediaDetailPageProps {
  media: {
    id: string;
    title: string;
    year: number;
    poster: string | null;
    url: string | null;
    reviews: any[];
  };
  type: "movie" | "show";
}

const MediaDetailPage: FC<MediaDetailPageProps> = ({ media, type }) => {
  // Deduplicate episodes from extraReviews and assignmentReviews
  const linkedEpisodesMap = new Map();
  media.reviews.forEach((review) => {
    review.extraReviews.forEach((er: any) => {
      if (er.episode) linkedEpisodesMap.set(er.episode.id, er.episode);
    });
    review.assignmentReviews.forEach((ar: any) => {
      if (ar.assignment?.episode)
        linkedEpisodesMap.set(ar.assignment.episode.id, ar.assignment.episode);
    });
  });
  const linkedEpisodes = Array.from(linkedEpisodesMap.values()).sort(
    (a: any, b: any) => b.number - a.number
  );

  const backPath = type === "movie" ? "/movie" : "/show";
  const backLabel = type === "movie" ? "Back to Movies" : "Back to Shows";
  const typeLabel = type === "movie" ? "Movie" : "TV Show";
  const MediaIcon = type === "movie" ? Film : Tv;

  return (
    <>
      <Head>
        <title>{`${media.title} - ${typeLabel} Details | BBPC Admin`}</title>
      </Head>

      <div className="flex flex-col gap-8">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            asChild
            className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
          >
            <Link href={backPath}>
              <ChevronLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
        </div>

        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-3xl border bg-card p-8 shadow-lg">
          <div className="pointer-events-none absolute right-0 top-0 p-12 opacity-[0.05]">
            <MediaIcon className="h-48 w-48" />
          </div>

          <div className="relative z-10 flex flex-col gap-8 md:flex-row">
            {/* Poster */}
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border bg-muted shadow-2xl md:w-48">
              {media.poster ? (
                <Image
                  unoptimized
                  src={media.poster}
                  alt={media.title}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <MediaIcon className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex flex-col justify-center gap-4">
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className="h-6 border-primary/20 bg-primary/5 px-2 py-0 text-[10px] font-bold uppercase tracking-wider text-primary"
                >
                  {typeLabel}
                </Badge>
                <Badge
                  variant="secondary"
                  className="h-6 px-2 py-0 text-[10px] font-bold uppercase tracking-wider"
                >
                  {media.year}
                </Badge>
              </div>

              <h1 className="text-4xl font-black tracking-tighter md:text-5xl">
                {media.title}
              </h1>

              {media.url ? (
                <div className="flex items-center gap-6">
                  <a
                    href={media.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View Details
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium italic text-muted-foreground">
                  No external link available
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Linked Episodes */}
          <div className="flex flex-col gap-6 lg:col-span-1">
            <Card className="border-none bg-gradient-to-br from-card to-muted/30 shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mic2 className="h-5 w-5 text-primary" />
                  Linked Episodes
                </CardTitle>
                <CardDescription>
                  Episodes where this {type} was reviewed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                  {linkedEpisodes.length > 0 ? (
                    linkedEpisodes.map((episode: any) => (
                      <Link
                        key={episode.id}
                        href={getAdminEpisodePath(episode.slug ?? episode.id)}
                        className="group flex items-center justify-between rounded-xl border bg-card p-3 transition-all hover:bg-accent"
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-bold transition-colors group-hover:text-primary">
                            Ep. {episode.number}: {episode.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {episode.date
                              ? formatPlainDate(episode.date)
                              : "No date"}
                          </span>
                        </div>
                        <ChevronLeft className="h-4 w-4 translate-x-1 rotate-180 transform opacity-0 transition-all group-hover:opacity-100" />
                      </Link>
                    ))
                  ) : (
                    <p className="text-sm italic text-muted-foreground">
                      No episodes linked yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Reviews List */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card className="border-none shadow-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5 text-yellow-500" />
                  Reviews
                </CardTitle>
                <CardDescription>
                  All user reviews for this {type}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Rating</TableHead>
                        <TableHead>Episode</TableHead>
                        <TableHead className="text-right">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {media.reviews.length > 0 ? (
                        media.reviews.map((review) => {
                          const rec =
                            review.extraReviews[0]?.episode ||
                            review.assignmentReviews[0]?.assignment?.episode;
                          return (
                            <TableRow key={review.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                                    {review.user?.image ? (
                                      <Image
                                        unoptimized
                                        src={review.user.image}
                                        alt=""
                                        width={24}
                                        height={24}
                                        className="object-cover"
                                      />
                                    ) : (
                                      <User className="h-3 w-3 text-primary" />
                                    )}
                                  </div>
                                  <span className="whitespace-nowrap font-medium">
                                    {review.user?.name || "Unknown"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {review.rating ? (
                                  <Badge
                                    variant="secondary"
                                    className="gap-1 px-1.5 py-0"
                                  >
                                    <RatingIcon value={review.rating.value} />
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">
                                    -
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {rec ? (
                                  <Link
                                    href={getAdminEpisodePath(
                                      rec.slug ?? rec.id
                                    )}
                                    className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
                                  >
                                    Ep. {rec.number}
                                  </Link>
                                ) : (
                                  <span className="text-xs italic text-muted-foreground">
                                    Unlinked
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                                {review.reviewedOn
                                  ? formatInstantLocal(review.reviewedOn)
                                  : "-"}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="py-8 text-center italic text-muted-foreground"
                          >
                            No reviews found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
};

export default MediaDetailPage;
