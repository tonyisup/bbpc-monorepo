'use client';

import { useState } from 'react';
import type { Manifest, RecordingUploadMetadata, SounderAsset } from '@/types';
import { downloadSessionMergeBundle } from '@/lib/export-labels';

interface ExportBarProps {
  manifest: Manifest;
}

export function ExportBar({ manifest }: ExportBarProps) {
  const [bundleStatus, setBundleStatus] = useState<'idle' | 'preparing' | 'ok' | 'error'>('idle');

  const buildSounderAssets = async (): Promise<SounderAsset[]> => {
    const usedIds = new Set(manifest.sounders_used.map(sounder => sounder.id));
    if (usedIds.size === 0) return [];

    const res = await fetch('/api/sounders/list');
    if (!res.ok) throw new Error(`Sounders fetch failed: ${res.status}`);
    const body = await res.json() as { sounders?: Array<Omit<SounderAsset, 'downloadUrl'>> };
    const origin = window.location.origin;

    return (body.sounders ?? [])
      .filter(sounder => usedIds.has(sounder.id))
      .map(sounder => ({
        ...sounder,
        downloadUrl: new URL(sounder.url, origin).toString(),
      }));
  };

  const handleDownloadBundle = async () => {
    if (!manifest.session_id) {
      setBundleStatus('error');
      setTimeout(() => setBundleStatus('idle'), 3000);
      return;
    }

    setBundleStatus('preparing');
    try {
      const res = await fetch(`/api/sessions/${manifest.session_id}/recordings`);
      if (!res.ok) throw new Error(`Recordings fetch failed: ${res.status}`);
      const body = await res.json() as { recordings?: RecordingUploadMetadata[] };
      const sounderAssets = await buildSounderAssets();
      downloadSessionMergeBundle(manifest, body.recordings ?? [], sounderAssets);
      setBundleStatus('ok');
      setTimeout(() => setBundleStatus('idle'), 3000);
    } catch (err) {
      console.error('[Bundle]', err);
      setBundleStatus('error');
      setTimeout(() => setBundleStatus('idle'), 3000);
    }
  };

  return (
    <div className="flex gap-3 p-4 border-t border-[var(--card-border)] bg-[var(--card-bg)]">
      <button
        onClick={handleDownloadBundle}
        disabled={bundleStatus === 'preparing'}
        className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
          bundleStatus === 'ok'
            ? 'border-[var(--success)] text-[var(--success)]'
            : bundleStatus === 'error'
            ? 'border-[var(--danger)] text-[var(--danger)]'
            : 'border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50'
        }`}
      >
        {bundleStatus === 'preparing' ? 'Preparing Bundle...'
          : bundleStatus === 'ok' ? 'Bundle Downloaded'
          : bundleStatus === 'error' ? 'Bundle Failed'
          : 'Download Merge Bundle'}
      </button>
      <span className="ml-auto text-xs text-[var(--muted)] self-center">
        {manifest.episode} · {manifest.recording_participants.length} recording intervals · {manifest.audio_participants.length} audio intervals · {manifest.sounders_used.length} sounders · {manifest.notes.length} notes
      </span>
    </div>
  );
}
