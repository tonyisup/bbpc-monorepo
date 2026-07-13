export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

export interface RecordingUploadInput {
  sessionId: string;
  episode: string;
  hostName: string;
  trackType: 'mic' | 'sounders';
  startedAt: number;
  audioBase64: string;
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
