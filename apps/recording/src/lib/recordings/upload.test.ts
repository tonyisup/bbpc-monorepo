import { describe, expect, it } from 'vitest';
import {
  MAX_RECORDING_BYTES,
  estimatedBase64Bytes,
  parseRecordingUploadInput,
  safeBlobSegment,
  recordingExtension,
} from './upload';

describe('recording upload boundary', () => {
  const valid = {
    sessionId: 'sess_123',
    episode: 'EP-1',
    hostName: 'Host',
    trackType: 'mic' as const,
    startedAt: 1_000,
    audioBase64: 'YWJj',
    contentType: 'audio/webm',
  };

  it('rejects anonymous uploads without a session id', () => {
    expect(parseRecordingUploadInput({ ...valid, sessionId: undefined })).toBeNull();
  });

  it('rejects invalid track types and timestamps', () => {
    expect(parseRecordingUploadInput({ ...valid, trackType: 'video' })).toBeNull();
    expect(parseRecordingUploadInput({ ...valid, startedAt: Number.NaN })).toBeNull();
  });

  it('keeps supported fallback MIME types and rejects non-audio formats', () => {
    expect(parseRecordingUploadInput({ ...valid, contentType: 'audio/ogg;codecs=opus' })?.contentType).toBe('audio/ogg;codecs=opus');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(parseRecordingUploadInput({ ...valid, contentType: 'text/html' })).toBeNull();
    expect(parseRecordingUploadInput({ ...valid, contentType: undefined })).toBeNull();
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
