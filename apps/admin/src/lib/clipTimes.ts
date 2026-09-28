export const MAX_CLIP_SECONDS = 86_400;

/** Editor-picked times carry milliseconds; a tenth is enough to cue a clip. */
export function clipSeconds(value: number): string {
  return `${String(Math.round(value * 10) / 10)}s`;
}

/** Round a player time to the tenth of a second the marker works in. */
export function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A player time as M:SS.s, the form the clip marker shows and reads. */
export function formatClipTime(value: number): string {
  const total = Math.round(Math.max(0, value) * 10);
  const minutes = Math.floor(total / 600);
  const seconds = ((total - minutes * 600) / 10).toFixed(1).padStart(4, "0");
  return `${String(minutes)}:${seconds}`;
}

/**
 * Read a typed clip time: seconds ("65.2"), M:SS.s or H:MM:SS.s. Empty text is
 * null; anything else unreadable is NaN.
 */
export function parseClipTime(text: string): number | null {
  const value = text.trim();
  if (value.length === 0) return null;
  const parts = value.split(":");
  if (
    parts.length > 3 ||
    parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part)) ||
    parts.slice(0, -1).some((part) => part.includes(".")) ||
    (parts.length > 1 && parts.slice(1).some((part) => Number(part) >= 60))
  ) {
    return Number.NaN;
  }
  return tenths(parts.reduce((sum, part) => sum * 60 + Number(part), 0));
}
