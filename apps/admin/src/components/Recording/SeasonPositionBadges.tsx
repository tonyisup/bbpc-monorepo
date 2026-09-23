import { Badge } from "../ui/badge";
import { getSeasonFinaleState } from "./recordingManagementModel";

/** The episode's place in its season, and whether it ends or overruns it. */
export function SeasonPositionBadges({
  position,
  season,
}: {
  position: number | null;
  season: { title: string; episodeCount: number | null } | null;
}) {
  if (season === null || position === null) {
    return null;
  }
  const finaleState = getSeasonFinaleState(position, season.episodeCount);
  return (
    <>
      <Badge variant="outline">
        #{position}
        {season.episodeCount !== null && ` of ${season.episodeCount}`} in{" "}
        {season.title}
      </Badge>
      {finaleState !== null && (
        <Badge variant={finaleState === "finale" ? "default" : "destructive"}>
          {finaleState === "finale" ? "Season finale" : "Past season length"}
        </Badge>
      )}
    </>
  );
}
