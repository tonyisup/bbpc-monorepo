export type TranscriptCue = { start: number; end: number; text: string };

export const MAX_CLIP_SECONDS = 86_400;
export const MAX_CAPTION_BYTES = 500_000;
export const MAX_QUOTE_TEXT_LENGTH = 2000;

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

export function formatClipTime(value: number) {
  const tenths = Math.round(Math.max(0, value) * 10);
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(
    2,
    "0"
  )}.${tenths % 10}`;
}

export function validClipRange(start: number | null, end: number | null) {
  return (
    (start === null ||
      (Number.isFinite(start) && start >= 0 && start <= MAX_CLIP_SECONDS)) &&
    (end === null ||
      (start !== null &&
        Number.isFinite(end) &&
        end > start &&
        end <= MAX_CLIP_SECONDS))
  );
}

function captionTime(value: string) {
  const match = value.match(/^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return NaN;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}

function captionText(value: string) {
  return value
    .replace(/<[^<>]*>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        }[entity] ?? entity)
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Preserve real cue/inline timings; never invent per-word timestamps. */
export function parseCaptions(input: string): TranscriptCue[] {
  if (input.length > MAX_CAPTION_BYTES)
    throw new Error("Use a subtitle file smaller than 500 KB.");
  const cues: TranscriptCue[] = [];
  for (const block of input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)) {
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block)) continue;
    const lines = block.split("\n");
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) continue;
    const timing = lines[index]?.match(/^(\S+)\s+-->\s+(\S+)/);
    if (!timing)
      throw new Error(
        "A subtitle timestamp could not be read. Use SRT or WebVTT."
      );
    const start = captionTime(timing[1] ?? "");
    const end = captionTime(timing[2] ?? "");
    if (!validClipRange(start, end))
      throw new Error("Subtitle times must increase and stay within 24 hours.");
    const text = lines.slice(index + 1).join(" ");
    const parts = text.split(/<((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})>/);
    let cursor = start;
    for (let i = 0; i < parts.length; i += 2) {
      const next =
        parts[i + 1] === undefined ? end : captionTime(parts[i + 1] ?? "");
      if (!Number.isFinite(next) || next < cursor || next > end)
        throw new Error("Word timestamps must stay inside their subtitle cue.");
      const words = captionText(parts[i] ?? "");
      if (words && next > cursor)
        cues.push({ start: cursor, end: next, text: words });
      cursor = next;
    }
    if (cues.length > 10_000)
      throw new Error("Use a shorter transcript (up to 10,000 timed blocks).");
  }
  if (cues.length === 0)
    throw new Error(
      "No timed subtitles found. Paste SRT or WebVTT with timestamps."
    );
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function selectCueRange(
  cues: TranscriptCue[],
  anchor: number,
  focus: number
) {
  const selected = cues.slice(
    Math.min(anchor, focus),
    Math.max(anchor, focus) + 1
  );
  return {
    start: Math.min(...selected.map((cue) => cue.start)),
    end: Math.max(...selected.map((cue) => cue.end)),
    text: selected.map((cue) => cue.text).join(" "),
  };
}
