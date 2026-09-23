const pacificDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Pacific calendar day a point was earned on, as YYYY-MM-DD. */
export function pacificPointDay(earnedAt: number): string {
  return pacificDayFormatter.format(earnedAt);
}
