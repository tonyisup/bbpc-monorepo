export function initials(name: string | null): string {
  if (name === null) {
    return "U";
  }
  return (
    name
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}

export function plural(
  count: number,
  singular: string,
  pluralForm: string
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
