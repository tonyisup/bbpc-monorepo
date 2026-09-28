/** Quote clip times are capped at a day, as the stored clip fields are. */
export const MAX_CLIP_SECONDS = 86_400;

/** A plain watch link; with a start, it opens at that second. */
export function youtubeWatchUrl(id: string, start: number | null = null) {
  const url = `https://www.youtube.com/watch?v=${id}`;
  return start !== null && start >= 1
    ? `${url}&t=${String(Math.floor(start))}s`
    : url;
}

export function parseYouTubeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    const id =
      host === "youtu.be"
        ? parts[0]
        : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(
            host
          )
        ? parts[0] === "watch"
          ? url.searchParams.get("v")
          : ["embed", "shorts", "live"].includes(parts[0] ?? "")
          ? parts[1]
          : null
        : null;
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    const time =
      url.searchParams.get("t") ??
      url.searchParams.get("start") ??
      url.hash.match(/^#t=(.+)$/)?.[1] ??
      "";
    const units = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    const seconds = /^\d+(?:\.\d+)?$/.test(time)
      ? Number(time)
      : units
      ? Number(units[1] ?? 0) * 3600 +
        Number(units[2] ?? 0) * 60 +
        Number(units[3] ?? 0)
      : 0;
    return { id, start: Math.min(MAX_CLIP_SECONDS, seconds) };
  } catch {
    return null;
  }
}
