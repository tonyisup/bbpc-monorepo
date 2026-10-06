import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { MAX_ASSIGNMENTS_PER_EPISODE } from "../assignments/limits.js";
import { domainError } from "../lib/errors.js";
import { MAX_REVIEW_RELATIONSHIPS } from "../reviews/limits.js";
import {
  MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS,
  MAX_GAMBLING_ENTRIES_PER_READ,
  MAX_GUESSES_PER_ASSIGNMENT,
  MAX_QUOTE_SUBMISSIONS_PER_EPISODE,
  MAX_UNPUBLISHED_EPISODES,
} from "./limits.js";

type EmbargoReadContext = Pick<QueryCtx, "db">;

/**
 * What listeners may not see yet. Points are awarded at the recording, but a
 * result is only public once its episode is published, so every
 * listener-facing read leaves out whatever belongs to an unpublished episode.
 * Administrator and recording reads do not use this.
 */
export interface ResultEmbargo {
  /** Points awarded for unpublished episodes. */
  pointIds: ReadonlySet<Id<"points">>;
  /**
   * Wagers on unpublished episodes' assignments. Everyone form: every
   * settled wager. Listener form: only that listener's, settled or not.
   */
  wagers: ReadonlyArray<Doc<"gamblingEntries">>;
}

function assertWithin(
  rows: unknown[],
  limit: number,
  relationship: string,
): void {
  if (rows.length > limit) {
    domainError(
      "CONFLICT",
      `Unpublished ${relationship} exceed the supported result limit.`,
      { details: { relationship, limit } },
    );
  }
}

/**
 * Every episode that is not published. "Published" and "published" both
 * count as published, so this reads the three status ranges around them; an
 * episode with no status sorts into the first. These ranges and
 * isPublishedStatus in lib/transcriptVisibility.ts state the same rule and
 * must change together.
 */
async function readUnpublishedEpisodes(
  ctx: EmbargoReadContext,
): Promise<Array<Doc<"episodes">>> {
  const ranges = await Promise.all([
    ctx.db
      .query("episodes")
      .withIndex("by_status_and_number", (index) =>
        index.lt("status", "Published"),
      )
      .take(MAX_UNPUBLISHED_EPISODES + 1),
    ctx.db
      .query("episodes")
      .withIndex("by_status_and_number", (index) =>
        index.gt("status", "Published").lt("status", "published"),
      )
      .take(MAX_UNPUBLISHED_EPISODES + 1),
    ctx.db
      .query("episodes")
      .withIndex("by_status_and_number", (index) =>
        index.gt("status", "published"),
      )
      .take(MAX_UNPUBLISHED_EPISODES + 1),
  ]);
  const episodes = ranges.flat();
  assertWithin(episodes, MAX_UNPUBLISHED_EPISODES, "episodes");
  return episodes;
}

/**
 * The embargo for everyone, or for one listener when `userId` is given.
 *
 * The everyone form reads only rows that can carry an award: settled wagers,
 * bracket quotes, point links, and guesses once their assignment has been
 * settled or their host has rated. What listeners write during an open round
 * (pending wagers, new guesses, new quotes) stays out of it, so that traffic
 * neither re-runs every subscribed read nor counts against the limits here.
 * It misses two awards only an administrator can create by hand: a point
 * attached to a guess before any settlement or rating exists, and one
 * attached to a wager that is not settled. A wager with no assignment
 * belongs to no episode, so it is never held.
 *
 * The listener form reads that listener's rows through their own indexes,
 * which keeps a balance check inside a mutation from depending on anyone
 * else's entries.
 */
export async function loadResultEmbargo(
  ctx: EmbargoReadContext,
  userId?: Id<"users">,
): Promise<ResultEmbargo> {
  const episodes = await readUnpublishedEpisodes(ctx);
  const pointIds = new Set<Id<"points">>();
  const wagers: Array<Doc<"gamblingEntries">> = [];
  const hold = (pointId: Id<"points"> | undefined) => {
    if (pointId !== undefined) {
      pointIds.add(pointId);
    }
  };

  await Promise.all(
    episodes.map(async (episode) => {
      const [assignments, quotes] = await Promise.all([
        ctx.db
          .query("assignments")
          .withIndex("by_episodeId", (index) =>
            index.eq("episodeId", episode._id),
          )
          .take(MAX_ASSIGNMENTS_PER_EPISODE + 1),
        userId === undefined
          ? // Only a bracket entry can be placed.
            ctx.db
              .query("quoteSubmissions")
              .withIndex("by_episodeId_and_status", (index) =>
                index.eq("episodeId", episode._id).eq("status", "INCLUDED"),
              )
              .take(MAX_QUOTE_SUBMISSIONS_PER_EPISODE + 1)
          : ctx.db
              .query("quoteSubmissions")
              .withIndex("by_episodeId_and_userId", (index) =>
                index.eq("episodeId", episode._id).eq("userId", userId),
              )
              .take(MAX_QUOTE_SUBMISSIONS_PER_EPISODE + 1),
      ]);
      assertWithin(assignments, MAX_ASSIGNMENTS_PER_EPISODE, "assignments");
      assertWithin(quotes, MAX_QUOTE_SUBMISSIONS_PER_EPISODE, "quotes");
      for (const quote of quotes) {
        hold(quote.pointId);
      }

      await Promise.all(
        assignments.map(async (assignment) => {
          const [links, reviews, entries, settlement] = await Promise.all([
            userId === undefined
              ? ctx.db
                  .query("assignmentPointLinks")
                  .withIndex("by_assignmentId", (index) =>
                    index.eq("assignmentId", assignment._id),
                  )
                  .take(MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS + 1)
              : ctx.db
                  .query("assignmentPointLinks")
                  .withIndex("by_assignmentId_and_userId", (index) =>
                    index
                      .eq("assignmentId", assignment._id)
                      .eq("userId", userId),
                  )
                  .take(MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS + 1),
            ctx.db
              .query("assignmentReviews")
              .withIndex("by_assignmentId", (index) =>
                index.eq("assignmentId", assignment._id),
              )
              .take(MAX_REVIEW_RELATIONSHIPS + 1),
            userId === undefined
              ? readSettledWagers(ctx, assignment._id)
              : ctx.db
                  .query("gamblingEntries")
                  .withIndex("by_userId_and_assignmentId", (index) =>
                    index
                      .eq("userId", userId)
                      .eq("assignmentId", assignment._id),
                  )
                  .take(MAX_GAMBLING_ENTRIES_PER_READ + 1),
            // Only the everyone form needs to know whether the assignment
            // has been settled; see the guesses below.
            userId === undefined
              ? ctx.db
                  .query("guessSettlements")
                  .withIndex("by_assignmentId", (index) =>
                    index.eq("assignmentId", assignment._id),
                  )
                  .first()
              : null,
          ]);
          assertWithin(
            links,
            MAX_ASSIGNMENT_POINT_LINKS_FOR_TOTALS,
            "point links",
          );
          assertWithin(reviews, MAX_REVIEW_RELATIONSHIPS, "reviews");
          assertWithin(entries, MAX_GAMBLING_ENTRIES_PER_READ, "wagers");
          for (const link of links) {
            hold(link.pointId);
          }
          for (const entry of entries) {
            hold(entry.awardPointId);
            wagers.push(entry);
          }

          await Promise.all(
            reviews.map(async (assignmentReview) => {
              let guesses: Array<Doc<"guesses">>;
              if (userId === undefined) {
                // Guesses earn points when the assignment is settled against
                // the hosts' ratings. A settled assignment keeps its guesses
                // held even if a rating is cleared afterwards.
                if (settlement === null) {
                  const review = await ctx.db.get(
                    "reviews",
                    assignmentReview.reviewId,
                  );
                  if (review?.ratingId === undefined) {
                    return;
                  }
                }
                guesses = await ctx.db
                  .query("guesses")
                  .withIndex("by_assignmentReviewId", (index) =>
                    index.eq("assignmentReviewId", assignmentReview._id),
                  )
                  .take(MAX_GUESSES_PER_ASSIGNMENT + 1);
              } else {
                guesses = await ctx.db
                  .query("guesses")
                  .withIndex("by_userId_and_assignmentReviewId", (index) =>
                    index
                      .eq("userId", userId)
                      .eq("assignmentReviewId", assignmentReview._id),
                  )
                  .take(MAX_GUESSES_PER_ASSIGNMENT + 1);
              }
              assertWithin(guesses, MAX_GUESSES_PER_ASSIGNMENT, "guesses");
              for (const guess of guesses) {
                hold(guess.pointId);
              }
            }),
          );
        }),
      );
    }),
  );
  return { pointIds, wagers };
}

/** Won and lost wagers on one assignment; pending and locked ones hold no award. */
async function readSettledWagers(
  ctx: EmbargoReadContext,
  assignmentId: Id<"assignments">,
): Promise<Array<Doc<"gamblingEntries">>> {
  const settled = await Promise.all(
    (["won", "lost"] as const).map(
      async (status) =>
        await ctx.db
          .query("gamblingEntries")
          .withIndex("by_assignmentId_and_status", (index) =>
            index.eq("assignmentId", assignmentId).eq("status", status),
          )
          .take(MAX_GAMBLING_ENTRIES_PER_READ + 1),
    ),
  );
  return settled.flat();
}

/** The points a listener may see, in their original order. */
export function visiblePoints(
  points: ReadonlyArray<Doc<"points">>,
  embargo: Pick<ResultEmbargo, "pointIds">,
): Array<Doc<"points">> {
  const visible: Array<Doc<"points">> = [];
  for (const point of points) {
    if (!embargo.pointIds.has(point._id)) {
      visible.push(point);
    }
  }
  return visible;
}
