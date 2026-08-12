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
  assignment: EpisodeAssignment;
  showMovieTitles?: boolean;
  searchQuery?: string;
  fuseMatches?: ReadonlyArray<FuseResultMatch>;
  assignmentRefIndex?: number;
}

const Assignment: FC<AssignmentProps> = ({
  assignment,
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
        />
      )}
      {showMovieTitles && assignment.movie && (
        <div className="text-sm text-gray-500">
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
