import { describe, expect, it } from 'vitest';
import {
  MAX_RECORDING_BLOCKS,
  RECORDING_BLOCK_BYTES,
  parseRecordingTakeInput,
  recordingExtension,
  safeBlobSegment,
} from './upload';

describe('recording upload boundary', () => {
  const valid = {
    sessionId: 'sess_123',
    trackType: 'mic',
    startedAt: 1_000,
    contentType: 'audio/webm',
  };

  it('rejects uploads without a session id', () => {
    expect(parseRecordingTakeInput({ ...valid, sessionId: undefined })).toBeNull();
  });

  it('rejects invalid track types and timestamps, and reads numeric query values', () => {
    expect(parseRecordingTakeInput({ ...valid, trackType: 'video' })).toBeNull();
    expect(parseRecordingTakeInput({ ...valid, startedAt: Number.NaN })).toBeNull();
    expect(parseRecordingTakeInput({ ...valid, startedAt: '1.5' })).toBeNull();
    expect(parseRecordingTakeInput({ ...valid, startedAt: '1000' })?.startedAt).toBe(1_000);
  });

  it('keeps supported fallback MIME types and rejects non-audio formats', () => {
    expect(parseRecordingTakeInput({ ...valid, contentType: 'audio/ogg;codecs=opus' })?.contentType).toBe('audio/ogg;codecs=opus');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
    expect(parseRecordingTakeInput({ ...valid, contentType: 'text/html' })).toBeNull();
    expect(parseRecordingTakeInput({ ...valid, contentType: undefined })).toBeNull();
  });

  it('keeps each upload request under the 4.5 MB hosting limit', () => {
    expect(RECORDING_BLOCK_BYTES).toBeLessThan(4.5 * 1000 * 1000);
    expect(MAX_RECORDING_BLOCKS).toBeLessThan(50_000); // Azure's block limit per blob
  });

  it('makes storage-safe blob segments', () => {
    expect(safeBlobSegment(' Harley / Host ')).toBe('Harley-Host');
    expect(safeBlobSegment('...')).toBe('participant');
    expect(safeBlobSegment('../../Guest / Name')).toBe('Guest-Name');
  });
});
