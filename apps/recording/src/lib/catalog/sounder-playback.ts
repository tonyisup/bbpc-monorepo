// The catalog lists only audio files, and only those are served.
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma']);

/**
 * A sounder blob name the catalog could have listed: one string, no hidden,
 * empty or traversal segments, and an audio file extension.
 */
export function sounderPath(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) return null;
  const segments = value.split('/');
  if (segments.some(segment => segment === '' || segment.startsWith('.'))) return null;
  const extension = value.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(extension) ? value : null;
}

/**
 * The single byte range a Range header asks for, clamped to the file, or
 * 'unsatisfiable'. Null means serve the whole file (no header, or a form this
 * route does not support, which RFC 9110 allows a server to ignore).
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    // A suffix range: the last n bytes.
    const length = Number(match[2]);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}
