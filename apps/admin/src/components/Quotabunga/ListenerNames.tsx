import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

import { Button } from "../ui/button";

export const HIDDEN_NAME = "Name hidden";

export function listenerName(submission: ConvexAdminQuoteSubmission): string {
  return submission.user.name ?? submission.user.email ?? "Unknown listener";
}

/** Points have been awarded for the round once any entry is scored. */
export function roundAwarded(
  submissions: readonly ConvexAdminQuoteSubmission[]
): boolean {
  return submissions.some((submission) => submission.scored);
}

/**
 * Listener names stay hidden until the round's points are awarded, so entries
 * are judged blind. An admin can still show them on purpose.
 */
export function useListenerNames(
  submissions: readonly ConvexAdminQuoteSubmission[]
) {
  const awarded = roundAwarded(submissions);
  const [peeking, setPeeking] = useState(false);
  return { awarded, peeking, setPeeking, shown: awarded || peeking };
}

export function ListenerNamesToggle({
  awarded,
  peeking,
  onPeekingChange,
}: {
  awarded: boolean;
  peeking: boolean;
  onPeekingChange: (peeking: boolean) => void;
}) {
  if (awarded) return null;
  return (
    <Button
      onClick={() => onPeekingChange(!peeking)}
      size="sm"
      title="Listener names stay hidden until the round's points are awarded."
      type="button"
      variant="outline"
    >
      {peeking ? (
        <EyeOff className="mr-2 h-4 w-4" />
      ) : (
        <Eye className="mr-2 h-4 w-4" />
      )}
      {peeking ? "Hide names" : "Show names"}
    </Button>
  );
}
