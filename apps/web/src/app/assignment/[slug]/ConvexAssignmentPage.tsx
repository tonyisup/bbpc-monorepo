import { notFound, permanentRedirect } from "next/navigation";

import Assignment from "@/components/Assignment";
import { isUuid } from "@/lib/ids";
import { getAssignmentPath } from "@/lib/routes";
import {
  getAssignmentByLegacyId,
  getAssignmentBySlug,
} from "@/server/convex/assignments";

import { ConvexAssignmentGameSegment } from "./ConvexAssignmentGameSegment";

interface ConvexAssignmentPageProps {
  slug: string;
}

export async function ConvexAssignmentPage({
  slug,
}: ConvexAssignmentPageProps) {
  const assignment =
    (await getAssignmentBySlug(slug)) ??
    (isUuid(slug) ? await getAssignmentByLegacyId(slug) : null);

  if (!assignment) {
    notFound();
  }

  if (assignment.slug && isUuid(slug) && assignment.slug !== slug) {
    permanentRedirect(getAssignmentPath(assignment.slug));
  }

  return (
    <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
      <Assignment assignment={assignment} />
      <ConvexAssignmentGameSegment assignment={assignment} />
    </div>
  );
}
