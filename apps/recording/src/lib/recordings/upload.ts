// About 18 hours of Opus at the browser's default 128 kbps.
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;
// Upload blocks stay under Vercel's 4.5 MB request body limit.
export const RECORDING_BLOCK_BYTES = 3 * 1024 * 1024;
export const MAX_RECORDING_BLOCKS = Math.ceil(MAX_RECORDING_BYTES / RECORDING_BLOCK_BYTES);

export interface RecordingTakeInput {
  sessionId: string;
  trackType: 'mic' | 'sounders';
  startedAt: number;
  contentType: string;
}

/** Validates the fields that identify one track of one take. */
export function parseRecordingTakeInput(value: Record<string, unknown>): RecordingTakeInput | null {
  const { sessionId, trackType, contentType } = value;
  const startedAt = typeof value.startedAt === 'string' ? Number(value.startedAt) : value.startedAt;
  if (
    typeof sessionId !== 'string'
    || !sessionId
    || (trackType !== 'mic' && trackType !== 'sounders')
    || typeof startedAt !== 'number'
    || !Number.isSafeInteger(startedAt)
    || startedAt <= 0
    || typeof contentType !== 'string'
    || recordingExtension(contentType) === null
  ) {
    return null;
  }
  return { sessionId, trackType, startedAt, contentType };
}

export function safeBlobSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'participant';
}

export function recordingExtension(contentType: string): 'webm' | 'ogg' | 'm4a' | null {
  switch (contentType.toLowerCase().split(';')[0].trim()) {
    case 'audio/webm': return 'webm';
    case 'audio/ogg': return 'ogg';
    case 'audio/mp4': return 'm4a';
    default: return null;
  }
}
