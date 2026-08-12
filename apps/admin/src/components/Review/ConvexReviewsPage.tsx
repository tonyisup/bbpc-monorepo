import { useConvex } from "convex/react";
import {
  ExternalLink,
  Film,
  Filter,
  Loader2,
  RefreshCw,
  Trash2,
  Tv,
  User,
} from "lucide-react";
import Head from "next/head";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import { loadConvexAdminRatings } from "@/convex/ratings";
import type { ConvexAdminRating } from "@/convex/ratings";
import {
  type ConvexAdminReview,
  type ConvexReviewDeleteImpact,
  type ConvexReviewRatingFilter,
  deleteConvexAdminReview,
  loadConvexAdminReviewsPage,
  loadConvexReviewDeleteImpact,
  setConvexAdminReviewRating,
} from "@/convex/reviews";
import {
  type ConvexAdminUser,
  loadConvexAdminUsersPage,
} from "@/convex/users";
import { formatInstantLocal } from "@/lib/dates";

import RatingIcon from "./RatingIcon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface PendingReviewDelete {
  review: ConvexAdminReview;
  impact: ConvexReviewDeleteImpact;
}

function writeFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The review or its deletion impact changed. Inspect it again before retrying.";
    case "NOT_FOUND":
      return "The review or rating is no longer available.";
    case "VALIDATION_FAILED":
      return "The review request did not pass validation.";
    case "WRITE_DISABLED":
      return "Review changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The review change could not be completed.";
  }
}

function linkedReviewCount(review: ConvexAdminReview): number {
  return review.assignmentReviews.length + review.extraReviews.length;
}

export function ConvexReviewsPage() {
  const convex = useConvex();
  const [reviews, setReviews] = useState<ConvexAdminReview[] | null>(null);
  const [ratings, setRatings] = useState<ConvexAdminRating[] | null>(null);
  const [users, setUsers] = useState<ConvexAdminUser[] | null>(null);
  const [userCatalogComplete, setUserCatalogComplete] = useState(true);
  const [ratingFilter, setRatingFilter] =
    useState<ConvexReviewRatingFilter>({ kind: "all" });
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pendingReviewId, setPendingReviewId] = useState<string | null>(null);
  const [loadingImpactId, setLoadingImpactId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<PendingReviewDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void Promise.all([
      loadConvexAdminReviewsPage(convex, null, {
        rating: ratingFilter,
        userId: userFilter,
      }),
      loadConvexAdminRatings(convex),
      loadConvexAdminUsersPage(convex, null),
    ])
      .then(([page, loadedRatings, usersPage]) => {
        if (!active) {
          return;
        }
        setReviews(page.reviews);
        setContinueCursor(page.continueCursor);
        setIsDone(page.isDone);
        setRatings(loadedRatings);
        setUsers(usersPage.users);
        setUserCatalogComplete(usersPage.isDone);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, ratingFilter, revision, userFilter]);

  const refresh = () => {
    setReviews(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminReviewsPage(convex, continueCursor, {
      rating: ratingFilter,
      userId: userFilter,
    })
      .then((page) => {
        setReviews((current) => [...(current ?? []), ...page.reviews]);
        setContinueCursor(page.continueCursor);
        setIsDone(page.isDone);
      })
      .catch(() => {
        toast.error("The next review page could not be loaded.");
      })
      .finally(() => setIsLoadingMore(false));
  };

  const setRating = (reviewId: string, ratingId: string | null) => {
    setPendingReviewId(reviewId);
    void setConvexAdminReviewRating(convex, reviewId, ratingId)
      .then(() => {
        toast.success("Review rating updated.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setPendingReviewId(null));
  };

  const preflightDelete = (review: ConvexAdminReview) => {
    setLoadingImpactId(review.id);
    void loadConvexReviewDeleteImpact(convex, review.id)
      .then((impact) => setPendingDelete({ review, impact }))
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setLoadingImpactId(null));
  };

  const deleteReview = () => {
    if (pendingDelete === null || isDeleting) {
      return;
    }
    setIsDeleting(true);
    void deleteConvexAdminReview(convex, pendingDelete.impact)
      .then((impact) => {
        toast.success(
          `Review deleted with ${String(
            impact.assignmentReviewCount + impact.extraReviewCount
          )} relationship link${
            impact.assignmentReviewCount + impact.extraReviewCount === 1
              ? ""
              : "s"
          } and ${String(impact.guessCount)} guess${
            impact.guessCount === 1 ? "" : "es"
          }.`
        );
        setPendingDelete(null);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
        setPendingDelete(null);
      })
      .finally(() => setIsDeleting(false));
  };

  return (
    <>
      <Head>
        <title>All Reviews - BBPC Admin</title>
      </Head>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">All Reviews</h2>
            <p className="text-muted-foreground">
              Audit paginated review records and their bounded relationships. (
              {reviews?.length ?? 0} loaded)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              onValueChange={(value) => {
                setReviews(null);
                setUserFilter(value === "all" ? null : value);
              }}
              value={userFilter ?? "all"}
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Filter by user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users?.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name ?? user.email ?? "Unnamed user"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              onValueChange={(value) => {
                setReviews(null);
                setRatingFilter(
                  value === "all"
                    ? { kind: "all" }
                    : value === "unrated"
                    ? { kind: "unrated" }
                    : { kind: "rating", id: value }
                );
              }}
              value={
                ratingFilter.kind === "rating"
                  ? ratingFilter.id
                  : ratingFilter.kind
              }
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Filter by rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ratings</SelectItem>
                <SelectItem value="unrated">No Rating</SelectItem>
                {ratings?.map((rating) => (
                  <SelectItem key={rating.id} value={rating.id}>
                    {rating.name} ({rating.value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!userCatalogComplete && (
              <span className="text-xs text-amber-600">
                User selector shows the first 50.
              </span>
            )}
          </div>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Reviews could not be loaded. No legacy SQL fallback was
              attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="rounded-md border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Linked To</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={6}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {reviews?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={6}>
                      No reviews found.
                    </TableCell>
                  </TableRow>
                )}
                {reviews?.map((review) => {
                  const media = review.movie ?? review.show;
                  const MediaIcon = review.movie === null ? Tv : Film;
                  return (
                    <TableRow className="group" key={review.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">
                              {review.user?.name ?? "Anonymous/imported"}
                            </p>
                            {review.user?.status === "disabled" && (
                              <Badge variant="outline">Disabled</Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <a
                          className="flex items-center gap-3 hover:underline"
                          href={media?.url}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {media?.poster !== null &&
                            media?.poster !== undefined &&
                            media.poster.length > 0 && (
                              <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded shadow-sm">
                                <Image
                                  alt={media.title}
                                  className="object-cover"
                                  fill
                                  src={media.poster}
                                  unoptimized
                                />
                              </div>
                            )}
                          <div>
                            <p className="flex items-center gap-1 text-sm font-bold">
                              <MediaIcon className="h-3 w-3" />
                              {media?.title ?? "Unknown content"}
                              <ExternalLink className="h-3 w-3" />
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {media?.year ?? "Unknown year"}
                            </p>
                          </div>
                        </a>
                      </TableCell>
                      <TableCell>
                        <Select
                          disabled={pendingReviewId === review.id}
                          onValueChange={(value) =>
                            setRating(
                              review.id,
                              value === "none" ? null : value
                            )
                          }
                          value={review.rating?.id ?? "none"}
                        >
                          <SelectTrigger className="h-8 w-[155px] border-none bg-transparent">
                            <SelectValue>
                              {review.rating === null ? (
                                <span className="text-xs italic text-muted-foreground">
                                  No Rating
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs font-semibold">
                                  <RatingIcon value={review.rating.value} />
                                  {review.rating.name}
                                </span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Rating</SelectItem>
                            {ratings?.map((rating) => (
                              <SelectItem key={rating.id} value={rating.id}>
                                {rating.name} ({rating.value})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {review.assignmentReviews.map((link) => (
                            <Badge key={link.id} variant="outline">
                              Ep {link.assignment.episode.number}{" "}
                              {link.assignment.type}
                            </Badge>
                          ))}
                          {review.extraReviews.map((link) => (
                            <Badge key={link.id} variant="secondary">
                              Ep {link.episode.number} Extra
                            </Badge>
                          ))}
                          {linkedReviewCount(review) === 0 && (
                            <span className="text-xs italic text-muted-foreground">
                              Standalone
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {review.reviewedAt === null
                          ? "Unknown"
                          : formatInstantLocal(new Date(review.reviewedAt))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          aria-label={`Inspect deletion for ${
                            media?.title ?? "review"
                          }`}
                          className="text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          disabled={loadingImpactId !== null}
                          onClick={() => preflightDelete(review)}
                          size="icon"
                          variant="ghost"
                        >
                          {loadingImpactId === review.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {!isDone && (
          <div className="flex justify-center py-4">
            <Button
              disabled={isLoadingMore}
              onClick={loadMore}
              variant="outline"
            >
              {isLoadingMore && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Load More
            </Button>
          </div>
        )}
      </div>

      <ConfirmModal
        description={
          pendingDelete === null
            ? ""
            : `Delete this review, ${String(
                pendingDelete.impact.assignmentReviewCount
              )} assignment link(s), ${String(
                pendingDelete.impact.extraReviewCount
              )} extra link(s), and ${String(
                pendingDelete.impact.guessCount
              )} guess(es)? Convex will reject the deletion if these exact counts change.`
        }
        isOpen={pendingDelete !== null}
        onClose={() => {
          if (!isDeleting) {
            setPendingDelete(null);
          }
        }}
        onConfirm={deleteReview}
        title="Delete Review Cascade"
      />
    </>
  );
}
