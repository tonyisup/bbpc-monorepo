'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { RecordingTracks } from './useRecordingEngine';
import { recordingExtension, safeBlobSegment } from '@/lib/recordings/upload';
import { uploadTrackInBlocks } from '@/lib/recordings/block-upload';
import { TRACK_TYPES, durableRecordingStore, type TrackType } from '@/lib/recordings/durable-store';

interface PendingRecording {
  tracks: RecordingTracks;
  episode: string;
  hostName: string;
  uploaded: Set<TrackType>;
  /** Blocks already staged per track, so a retry resumes. */
  blocks: Record<TrackType, Set<number>>;
  uploading: Promise<boolean> | null;
}
// Keep recovery available across client navigation. Takes captured with a
// durable sink are also on this device (IndexedDB) until they are uploaded or
// discarded; nothing is sent to a server until the participant uploads.
interface UploadSnapshot {
  pending: PendingRecording | null;
  status: 'idle' | 'uploading' | 'done' | 'error';
  error: string | null;
  /** Explains a take recovered from an earlier page load. */
  notice: string | null;
  /** Fraction of the pending take uploaded, while uploading. */
  progress: number | null;
}
const emptySnapshot: UploadSnapshot = { pending: null, status: 'idle', error: null, notice: null, progress: null };
const recoveries = new Map<string, UploadSnapshot>();
const restoring = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notifyRecoveryChange() { listeners.forEach(listener => listener()); }
function setSnapshot(sessionId: string, changes: Partial<UploadSnapshot>) {
  recoveries.set(sessionId, { ...(recoveries.get(sessionId) ?? emptySnapshot), ...changes });
  notifyRecoveryChange();
}
const serverSnapshot = () => emptySnapshot;

function pendingFor(tracks: RecordingTracks, episode: string, hostName: string, uploaded: TrackType[] = [], blocks?: Record<TrackType, number[]>): PendingRecording {
  return {
    tracks,
    episode,
    hostName,
    uploaded: new Set(uploaded),
    blocks: { mic: new Set(blocks?.mic), sounders: new Set(blocks?.sounders) },
    uploading: null,
  };
}

/**
 * Offer the oldest take left on this device by an earlier page load, unless
 * a take is already pending or the take is still being captured elsewhere.
 */
async function restoreFromDevice(sessionId: string): Promise<void> {
  const store = durableRecordingStore();
  if (!store || recoveries.get(sessionId)?.pending) return;
  try {
    for (const take of await store.listTakes(sessionId)) {
      if (await store.isTakeLive(take)) continue;
      const [mic, sounders] = await Promise.all(TRACK_TYPES.map(track => store.readTrack(take, track)));
      if (mic.size === 0 && sounders.size === 0) {
        await store.deleteTake(take.id);
        continue;
      }
      if (recoveries.get(sessionId)?.pending) return;
      const tracks: RecordingTracks = {
        mic,
        sounders,
        startedAt: take.startedAt,
        durationMs: take.durationMs ?? take.lastChunkAt - take.startedAt,
        takeId: take.id,
      };
      const uploaded = TRACK_TYPES.filter(track => take.tracks[track].committed);
      setSnapshot(sessionId, {
        pending: pendingFor(tracks, take.episode, take.hostName, uploaded, {
          mic: take.tracks.mic.uploadedBlocks,
          sounders: take.tracks.sounders.uploadedBlocks,
        }),
        status: 'idle',
        error: null,
        notice: take.state === 'capturing'
          ? 'Recovered audio from a recording that was interrupted. Upload it before recording again.'
          : 'Recovered audio saved on this device. Upload it before recording again.',
      });
      return;
    }
  } catch (error) {
    console.error('[Recording Upload] Could not read recordings saved on this device:', error);
  }
}

export function useRecordingUpload(sessionId: string, episode: string, hostName: string) {
  const { pending, status, error, notice, progress } = useSyncExternalStore(
    subscribe, useCallback(() => recoveries.get(sessionId) ?? emptySnapshot, [sessionId]), serverSnapshot,
  );

  useEffect(() => {
    if (!restoring.has(sessionId)) restoring.set(sessionId, restoreFromDevice(sessionId));
  }, [sessionId]);

  const retain = useCallback((tracks: RecordingTracks) => {
    const existing = recoveries.get(sessionId)?.pending;
    if (existing?.tracks === tracks) return;
    if (existing) throw new Error('Upload or discard the pending recording before replacing it.');
    setSnapshot(sessionId, { pending: pendingFor(tracks, episode, hostName), status: 'idle', error: null, notice: null, progress: null });
  }, [episode, hostName, sessionId]);

  const retry = useCallback((): Promise<boolean> => {
    const recovery = recoveries.get(sessionId)?.pending;
    if (!recovery) return Promise.resolve(true);
    if (recovery.uploading) return recovery.uploading;
    const store = durableRecordingStore();
    const takeId = recovery.tracks.takeId;
    const upload = async () => {
      const totalBytes = TRACK_TYPES.reduce((sum, type) => sum + (recovery.uploaded.has(type) ? 0 : recovery.tracks[type].size), 0);
      const doneBytes = new Map<TrackType, number>();
      const results = await Promise.allSettled(TRACK_TYPES.map(async type => {
        if (recovery.uploaded.has(type)) return;
        await uploadTrackInBlocks({
          sessionId,
          episode: recovery.episode,
          trackType: type,
          startedAt: recovery.tracks.startedAt,
          blob: recovery.tracks[type],
          uploadedBlocks: recovery.blocks[type],
          onBlockUploaded: async index => {
            recovery.blocks[type].add(index);
            if (store && takeId) await store.markBlockUploaded(takeId, type, index).catch(() => {});
          },
          onProgress: uploadedBytes => {
            doneBytes.set(type, uploadedBytes);
            if (totalBytes > 0 && recoveries.get(sessionId)?.pending === recovery) {
              setSnapshot(sessionId, { progress: [...doneBytes.values()].reduce((sum, bytes) => sum + bytes, 0) / totalBytes });
            }
          },
        });
        recovery.uploaded.add(type);
        if (store && takeId) await store.markCommitted(takeId, type).catch(() => {});
      }));
      const failure = results.find(result => result.status === 'rejected');
      // A response belongs only to the entry that initiated it.
      if (recoveries.get(sessionId)?.pending !== recovery) return !failure;
      if (failure?.status === 'rejected') {
        setSnapshot(sessionId, {
          status: 'error',
          progress: null,
          error: failure.reason instanceof Error
            ? `${failure.reason.message}. Retry, or download your audio.`
            : 'Upload failed. Your audio is still available below.',
        });
      } else {
        if (store && takeId) await store.deleteTake(takeId).catch(() => {});
        setSnapshot(sessionId, { pending: null, status: 'done', error: null, notice: null, progress: null });
        // Another take may still be waiting on this device.
        void restoreFromDevice(sessionId);
      }
      return !failure;
    };
    recovery.uploading = Promise.resolve().then(upload).finally(() => { recovery.uploading = null; });
    setSnapshot(sessionId, { status: 'uploading', error: null, progress: 0 });
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
    const recovery = recoveries.get(sessionId)?.pending;
    if (recovery?.uploading) return;
    const takeId = recovery?.tracks.takeId;
    recoveries.delete(sessionId);
    notifyRecoveryChange();
    const store = durableRecordingStore();
    if (store && takeId) {
      void store.deleteTake(takeId).catch(() => {}).then(() => restoreFromDevice(sessionId));
    }
  }, [sessionId]);

  return { pending, status, error, notice, progress, retain, upload, retry, download, discard,
    hasPending: () => !!recoveries.get(sessionId)?.pending };
}
