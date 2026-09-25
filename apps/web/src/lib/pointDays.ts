const pacificDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pacificLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  timeZone: "America/Los_Angeles",
});

/** The Pacific calendar day a point was earned on, as YYYY-MM-DD. */
export function pacificPointDay(earnedAt: number): string {
  return pacificDayFormatter.format(earnedAt);
}

/** A short Pacific-day label for chart axes, such as "Sep 22". */
export function formatPacificDayLabel(earnedAt: number): string {
  return pacificLabelFormatter.format(earnedAt);
}
