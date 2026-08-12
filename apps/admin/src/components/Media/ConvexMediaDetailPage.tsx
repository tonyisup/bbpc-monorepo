import { useConvex } from "convex/react";
import {
  ChevronLeft,
  ExternalLink,
  Film,
  Loader2,
  Mic2,
  RefreshCw,
  Star,
  Tv,
  User,
} from "lucide-react";
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import {
  loadConvexMovieDetail,
  loadConvexShowDetail,
  type ConvexMediaDetailReview,
  type ConvexMovieDetail,
  type ConvexShowDetail,
} from "@/convex/mediaDetails";
import { formatInstantLocal } from "@/lib/dates";

import RatingIcon from "../Review/RatingIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

type MediaKind = "movie" | "show";
type MediaDetail = ConvexMovieDetail | ConvexShowDetail;

interface LinkedEpisode {
  id: string;
  number: number;
  title: string;
  status: string | null;
  slug: string | null;
}

function linkedEpisodes(
  reviews: ConvexMediaDetailReview[]
): LinkedEpisode[] {
  const byId = new Map<string, LinkedEpisode>();
  for (const review of reviews) {
    for (const link of review.assignmentReviews) {
      byId.set(link.assignment.episode.id, link.assignment.episode);
    }
    for (const link of review.extraReviews) {
      byId.set(link.episode.id, link.episode);
    }
  }
  return [...byId.values()].sort(
    (left, right) => right.number - left.number
  );
}

function reviewEpisode(
  review: ConvexMediaDetailReview
): LinkedEpisode | null {
  return (
    review.extraReviews[0]?.episode ??
    review.assignmentReviews[0]?.assignment.episode ??
    null
  );
}

function ConvexMediaDetailPage({ kind }: { kind: MediaKind }) {
  const convex = useConvex();
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;
  const [detail, setDetail] = useState<MediaDetail | null | undefined>(
    undefined
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (id === null) {
      return;
    }
    let active = true;
    setDetail(undefined);
    setLoadFailed(false);
    void (kind === "movie"
      ? loadConvexMovieDetail(convex, id)
      : loadConvexShowDetail(convex, id)
    )
      .then((result) => {
        if (active) {
          setDetail(result);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, id, kind, revision]);

  const episodes = useMemo(
    () => (detail === null || detail === undefined ? [] : linkedEpisodes(detail.reviews)),
    [detail]
  );

  const backPath = kind === "movie" ? "/movie" : "/show";
  const backLabel = kind === "movie" ? "Back to Movies" : "Back to Shows";
  const typeLabel = kind === "movie" ? "Movie" : "TV Show";
  const MediaIcon = kind === "movie" ? Film : Tv;

  if (loadFailed) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          Media details could not be loaded. No legacy SQL fallback was
          attempted.
        </p>
        <Button
          onClick={() => setRevision((value) => value + 1)}
          variant="outline"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  if (detail === undefined) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-bold">{typeLabel} not found</h2>
        <Button asChild variant="outline">
          <Link href={backPath}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          {detail.media.title} - {typeLabel} Details | BBPC Admin
        </title>
      </Head>

      <div className="flex flex-col gap-8">
        <div>
          <Button
            asChild
            className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
            variant="ghost"
          >
            <Link href={backPath}>
              <ChevronLeft className="h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
        </div>

        <div className="relative overflow-hidden rounded-3xl border bg-card p-8 shadow-lg">
          <div className="pointer-events-none absolute right-0 top-0 p-12 opacity-[0.05]">
            <MediaIcon className="h-48 w-48" />
          </div>
          <div className="relative z-10 flex flex-col gap-8 md:flex-row">
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border bg-muted shadow-2xl md:w-48">
              {detail.media.poster === null ||
              detail.media.poster.length === 0 ? (
                <div className="flex h-full w-full items-center justify-center">
                  <MediaIcon className="h-12 w-12 text-muted-foreground" />
                </div>
              ) : (
                <Image
                  alt={detail.media.title}
                  className="object-cover"
                  fill
                  src={detail.media.poster}
                  unoptimized
                />
              )}
            </div>
            <div className="flex flex-col justify-center gap-4">
              <div className="flex items-center gap-3">
                <Badge variant="outline">{typeLabel}</Badge>
                <Badge variant="secondary">{detail.media.year}</Badge>
              </div>
              <h1 className="text-4xl font-black tracking-tighter md:text-5xl">
                {detail.media.title}
              </h1>
              <a
                className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                href={detail.media.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalLink className="h-4 w-4" />
                View external details
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <Card className="h-fit lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic2 className="h-5 w-5 text-primary" />
                Linked Episodes
              </CardTitle>
              <CardDescription>
                Bounded canonical assignment and extra-review links.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {episodes.length === 0 ? (
                  <p className="text-sm italic text-muted-foreground">
                    No episodes linked yet.
                  </p>
                ) : (
                  episodes.map((episode) => (
                    <div
                      className="rounded-xl border bg-card p-3"
                      key={episode.id}
                    >
                      <p className="text-sm font-bold">
                        Ep. {episode.number}: {episode.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {episode.status ?? "No status"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500" />
                Reviews
              </CardTitle>
              <CardDescription>
                Up to 100 canonical reviews with bounded relationships.
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
                    {detail.reviews.length === 0 && (
                      <TableRow>
                        <TableCell
                          className="py-8 text-center italic text-muted-foreground"
                          colSpan={4}
                        >
                          No reviews found.
                        </TableCell>
                      </TableRow>
                    )}
                    {detail.reviews.map((review) => {
                      const episode = reviewEpisode(review);
                      return (
                        <TableRow key={review.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                                {review.user?.image === null ||
                                review.user?.image === undefined ? (
                                  <User className="h-3 w-3 text-primary" />
                                ) : (
                                  <Image
                                    alt=""
                                    className="object-cover"
                                    height={24}
                                    src={review.user.image}
                                    unoptimized
                                    width={24}
                                  />
                                )}
                              </div>
                              <span className="whitespace-nowrap font-medium">
                                {review.user?.name ?? "Unknown"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {review.rating === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Badge
                                className="gap-1 px-1.5 py-0"
                                variant="secondary"
                              >
                                <RatingIcon value={review.rating.value} />
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {episode === null ? (
                              <span className="text-xs italic text-muted-foreground">
                                Unlinked
                              </span>
                            ) : (
                              <span className="whitespace-nowrap text-sm font-medium">
                                Ep. {episode.number}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                            {review.reviewedAt === null
                              ? "—"
                              : formatInstantLocal(
                                  new Date(review.reviewedAt)
                                )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export function ConvexMovieDetailPage() {
  return <ConvexMediaDetailPage kind="movie" />;
}

export function ConvexShowDetailPage() {
  return <ConvexMediaDetailPage kind="show" />;
}
