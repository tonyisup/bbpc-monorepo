export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

export interface RecordingUploadInput {
  sessionId: string;
  episode: string;
  hostName: string;
  trackType: 'mic' | 'sounders';
  startedAt: number;
  audioBase64: string;
  contentType: string;
}

export function parseRecordingUploadInput(value: unknown): RecordingUploadInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<RecordingUploadInput>;
  if (
    typeof input.sessionId !== 'string'
    || !input.sessionId
    || typeof input.episode !== 'string'
    || !input.episode.trim()
    || typeof input.hostName !== 'string'
    || !input.hostName.trim()
    || (input.trackType !== 'mic' && input.trackType !== 'sounders')
    || typeof input.startedAt !== 'number'
    || !Number.isFinite(input.startedAt)
    || input.startedAt <= 0
    || typeof input.audioBase64 !== 'string'
    || typeof input.contentType !== 'string'
    || recordingExtension(input.contentType) === null
  ) {
    return null;
  }

  return {
    sessionId: input.sessionId,
    episode: input.episode.trim().slice(0, 80),
    hostName: input.hostName.trim(),
    trackType: input.trackType,
    startedAt: input.startedAt,
    audioBase64: input.audioBase64,
    contentType: input.contentType!,
  };
}

export function estimatedBase64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
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
