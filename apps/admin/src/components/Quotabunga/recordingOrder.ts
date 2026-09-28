import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";
import { stableShuffle } from "@/lib/stableShuffle";

/**
 * The order the recording panel plays included entries in. Entries the prep
 * page randomized keep their bracket order; the rest follow in a random order
 * seeded by the episode, never in the order listeners submitted, and stable
 * across refreshes during the recording.
 */
export function recordingOrder(
  submissions: readonly ConvexAdminQuoteSubmission[],
  episodeId: string
): ConvexAdminQuoteSubmission[] {
  const included = submissions.filter(
    (submission) => submission.status === "INCLUDED"
  );
  const bracketed = included
    .filter((submission) => submission.bracketOrder !== null)
    .sort(
      (left, right) => (left.bracketOrder ?? 0) - (right.bracketOrder ?? 0)
    );
  const unbracketed = stableShuffle(
    included.filter((submission) => submission.bracketOrder === null),
    (submission) => submission.id,
    episodeId
  );
  return [...bracketed, ...unbracketed];
}
