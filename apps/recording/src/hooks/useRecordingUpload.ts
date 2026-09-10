'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { RecordingTracks } from './useRecordingEngine';
import { recordingExtension, safeBlobSegment } from '@/lib/recordings/upload';

type TrackType = 'mic' | 'sounders';
interface PendingRecording {
  tracks: RecordingTracks;
  episode: string;
  hostName: string;
  uploaded: Set<TrackType>;
  uploading: Promise<boolean> | null;
}
// Keep recovery available across client navigation. Nothing is written to a server
// or browser storage until the participant explicitly uploads/downloads it.
interface UploadSnapshot {
  pending: PendingRecording | null;
  status: 'idle' | 'uploading' | 'done' | 'error';
  error: string | null;
}
const emptySnapshot: UploadSnapshot = { pending: null, status: 'idle', error: null };
const recoveries = new Map<string, UploadSnapshot>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notifyRecoveryChange() { listeners.forEach(listener => listener()); }
const serverSnapshot = () => emptySnapshot;

export async function uploadRecordingTrack(
  sessionId: string, pending: PendingRecording, trackType: TrackType,
): Promise<void> {
  const blob = pending.tracks[trackType];
  if (blob.size === 0) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const res = await fetch('/api/recordings/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId, episode: pending.episode, hostName: pending.hostName, trackType,
      startedAt: pending.tracks.startedAt, audioBase64: btoa(binary), contentType: blob.type,
    }),
  });
  if (!res.ok) throw new Error(`Could not upload ${trackType} (${res.status}). Retry or download your audio.`);
}

export function useRecordingUpload(sessionId: string, episode: string, hostName: string) {
  const { pending, status, error } = useSyncExternalStore(
    subscribe, useCallback(() => recoveries.get(sessionId) ?? emptySnapshot, [sessionId]), serverSnapshot,
  );

  const retain = useCallback((tracks: RecordingTracks) => {
    const existing = recoveries.get(sessionId)?.pending;
    if (existing?.tracks === tracks) return;
    if (existing) throw new Error('Upload or discard the pending recording before replacing it.');
    const recovery: PendingRecording = { tracks, episode, hostName, uploaded: new Set<TrackType>(), uploading: null };
    recoveries.set(sessionId, { pending: recovery, status: 'idle', error: null });
    notifyRecoveryChange();
  }, [episode, hostName, sessionId]);

  const retry = useCallback((): Promise<boolean> => {
    const recovery = recoveries.get(sessionId)?.pending;
    if (!recovery) return Promise.resolve(true);
    if (recovery.uploading) return recovery.uploading;
    const upload = async () => {
      const results = await Promise.allSettled((['mic', 'sounders'] as const).map(async type => {
        if (recovery.uploaded.has(type)) return;
        await uploadRecordingTrack(sessionId, recovery, type);
        recovery.uploaded.add(type);
      }));
      const failure = results.find(result => result.status === 'rejected');
      // A response belongs only to the entry that initiated it.
      if (recoveries.get(sessionId)?.pending !== recovery) return !failure;
      if (failure?.status === 'rejected') {
        recoveries.set(sessionId, {
          pending: recovery, status: 'error',
          error: failure.reason instanceof Error ? failure.reason.message : 'Upload failed. Your audio is still available below.',
        });
      } else {
        recoveries.set(sessionId, { pending: null, status: 'done', error: null });
      }
      notifyRecoveryChange();
      return !failure;
    };
    recovery.uploading = Promise.resolve().then(upload).finally(() => { recovery.uploading = null; });
    recoveries.set(sessionId, { pending: recovery, status: 'uploading', error: null });
    notifyRecoveryChange();
    return recovery.uploading;
  }, [sessionId]);

  const upload = useCallback((tracks: RecordingTracks) => {
    retain(tracks);
    return retry();
  }, [retain, retry]);

  const download = useCallback((type: TrackType) => {
    const recovery = recoveries.get(sessionId)?.pending;
    if (!recovery) return;
    const blob = recovery.tracks[type];
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeBlobSegment(recovery.episode)}-${safeBlobSegment(recovery.hostName)}-${recovery.tracks.startedAt}-${type}.${recordingExtension(blob.type) ?? 'audio'}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [sessionId]);

  const discard = useCallback(() => {
    if (recoveries.get(sessionId)?.pending?.uploading) return;
    recoveries.delete(sessionId);
    notifyRecoveryChange();
  }, [sessionId]);

  return { pending, status, error, retain, upload, retry, download, discard,
    hasPending: () => !!recoveries.get(sessionId)?.pending };
}
