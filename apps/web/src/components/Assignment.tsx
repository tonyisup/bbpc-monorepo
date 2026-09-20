import { type FC } from "react";
import type { FuseResultMatch } from "fuse.js";
import HomeworkFlag from "./HomeworkFlag";
import MovieInlinePreview from "./MovieInlinePreview";
import UserTag from "./UserTag";
import {
  fuseIndicesForField,
  highlightText,
  highlightTextByIndices,
} from "@/utils/text";
import type { EpisodeAssignment } from "@/types/episode";

interface AssignmentProps {
  compact?: boolean;
  assignment: EpisodeAssignment;
  showMovieTitles?: boolean;
  searchQuery?: string;
  fuseMatches?: ReadonlyArray<FuseResultMatch>;
  assignmentRefIndex?: number;
}

const Assignment: FC<AssignmentProps> = ({
  assignment,
  compact = false,
  showMovieTitles = false,
  searchQuery = "",
  fuseMatches,
  assignmentRefIndex = -1,
}) => {
  const titleIdx =
    assignmentRefIndex >= 0
      ? fuseIndicesForField(
          fuseMatches,
          "assignments.movie.title",
          assignmentRefIndex
        )
      : [];

  return (
    <div className="flex flex-col items-center gap-2 p-2">
      {assignment.movie && (
        <MovieInlinePreview
          movie={assignment.movie}
          searchQuery={searchQuery}
          titleHighlightIndices={titleIdx}
          imageClassName={
            compact
              ? "h-[90px] w-[60px] rounded-md md:h-[90px] md:w-[60px]"
              : undefined
          }
          sizes={compact ? "60px" : undefined}
        />
      )}
      {(showMovieTitles || compact) && assignment.movie && (
        <div className="text-sm text-muted-foreground">
          {titleIdx.length > 0
            ? highlightTextByIndices(assignment.movie.title, titleIdx)
            : highlightText(assignment.movie.title, searchQuery)}{" "}
          ({assignment.movie.year})
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <HomeworkFlag type={assignment.type} />
        <UserTag user={assignment.user} />
      </div>
    </div>
  );
};

export default Assignment;
