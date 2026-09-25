export interface SeasonProgressValue {
  recorded: number;
  total: number;
}

/** Progress exists only for fixed-length seasons the backend could count. */
export function getSeasonProgress(data: {
  season: { episodeCount: number | null };
  recordedEpisodeCount: number | null;
}): SeasonProgressValue | null {
  const total = data.season.episodeCount;
  const recorded = data.recordedEpisodeCount;
  if (total === null || recorded === null) {
    return null;
  }
  return { recorded, total };
}

export function formatSeasonProgress({
  recorded,
  total,
}: SeasonProgressValue): string {
  return `${Math.min(recorded, total)} of ${total} episodes`;
}

function remainingLabel({ recorded, total }: SeasonProgressValue): string {
  const remaining = total - recorded;
  if (remaining <= 0) {
    return "Final episode recorded";
  }
  return remaining === 1 ? "1 episode to go" : `${remaining} episodes to go`;
}

export function SeasonProgress({ progress }: { progress: SeasonProgressValue }) {
  const percent = Math.min(100, (progress.recorded / progress.total) * 100);
  const label = formatSeasonProgress(progress);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-zinc-200">Season progress</span>
        <span className="text-zinc-400">
          {label} · {remainingLabel(progress)}
        </span>
      </div>
      <div
        aria-label={`${label} recorded`}
        aria-valuemax={progress.total}
        aria-valuemin={0}
        aria-valuenow={Math.min(progress.recorded, progress.total)}
        className="h-2 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-red-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
