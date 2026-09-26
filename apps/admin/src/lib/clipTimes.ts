export const MAX_CLIP_SECONDS = 86_400;

/** Editor-picked times carry milliseconds; a tenth is enough to cue a clip. */
export function clipSeconds(value: number): string {
  return `${String(Math.round(value * 10) / 10)}s`;
}
