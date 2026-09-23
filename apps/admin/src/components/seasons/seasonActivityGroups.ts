export interface SeasonActivityEpisode {
  id: string;
  number: number;
  title: string;
}

export interface SeasonActivityGroup<T> {
  key: string;
  episode: SeasonActivityEpisode | null;
  items: T[];
}

/**
 * Groups loaded activity by episode, newest episode first, keeping each
 * group's items in their loaded order. Activity without an episode (such as a
 * manual adjustment) goes last.
 */
export function groupSeasonActivityByEpisode<T>(
  items: readonly T[],
  getEpisode: (item: T) => SeasonActivityEpisode | null
): SeasonActivityGroup<T>[] {
  const groups = new Map<string, SeasonActivityGroup<T>>();
  for (const item of items) {
    const episode = getEpisode(item);
    const key = episode?.id ?? "none";
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { key, episode, items: [item] });
    } else {
      group.items.push(item);
    }
  }
  return [...groups.values()].sort((left, right) => {
    if (left.episode === null || right.episode === null) {
      return left.episode === null ? (right.episode === null ? 0 : 1) : -1;
    }
    return right.episode.number - left.episode.number;
  });
}
