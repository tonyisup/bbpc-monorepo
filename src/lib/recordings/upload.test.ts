import { describe, expect, it } from 'vitest';
import {
  MAX_RECORDING_BYTES,
  estimatedBase64Bytes,
  parseRecordingUploadInput,
  safeBlobSegment,
} from './upload';

describe('recording upload boundary', () => {
  const valid = {
    sessionId: 'sess_123',
    episode: 'EP-1',
    hostName: 'Host',
    trackType: 'mic' as const,
    startedAt: 1_000,
    audioBase64: 'YWJj',
  };

  it('rejects anonymous uploads without a session id', () => {
    expect(parseRecordingUploadInput({ ...valid, sessionId: undefined })).toBeNull();
  });

  it('rejects invalid track types and timestamps', () => {
    expect(parseRecordingUploadInput({ ...valid, trackType: 'video' })).toBeNull();
    expect(parseRecordingUploadInput({ ...valid, startedAt: Number.NaN })).toBeNull();
  });

  it('estimates decoded size before allocating the audio buffer', () => {
    expect(estimatedBase64Bytes('YWJj')).toBe(3);
    expect(estimatedBase64Bytes('YQ==')).toBe(1);
    expect(estimatedBase64Bytes('A'.repeat(Math.ceil((MAX_RECORDING_BYTES + 1) * 4 / 3))))
      .toBeGreaterThan(MAX_RECORDING_BYTES);
  });

  it('normalizes participant names used in blob paths', () => {
    expect(safeBlobSegment('../../Guest / Name')).toBe('Guest-Name');
  });
});
