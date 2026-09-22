import type {
  Manifest,
  MergeBundleRecording,
  RecordingParticipantInterval,
  RecordingUploadMetadata,
  SessionMergeBundle,
  SounderAsset,
} from '@/types';
import { timelineLengthMs, uploadTimelinePlacement } from './session-timeline';

/**
 * Convert a session manifest to Audacity label track format.
 *
 * Audacity plain-text label format: tab-separated columns
 *   start_seconds<TAB>end_seconds<TAB>label
 * One label per line, no header row, 6 decimal places.
 *
 * Mapping:
 *   Segments   → region labels  "{label}"
 *   Edit cues  → region labels  "{type}: {reason}"
 *   Notes      → 0.5s regions  "📝 {text}"
 *   Sounders   → point labels   "🔊 {name}"
 *   Pauses     → point labels   "⏸ Paused" where a later run resumed
 *
 * Segments and cues still open run to the end of the timeline and are marked
 * "(not ended)". Without recording runs (manifests before 1.2) the timeline
 * length is unknown, so open items are skipped.
 */
export function manifestToAudacityLabels(manifest: Manifest, now = Date.now()): string {
  const lines: string[] = [];
  const runs = manifest.recording_runs ?? [];
  const timelineEnd = runs.length ? timelineLengthMs(runs, now) : null;

  for (const seg of manifest.segments) {
    const end = seg.end_ms ?? timelineEnd;
    if (end === null) continue;
    lines.push(formatRegion(seg.start_ms, Math.max(end, seg.start_ms), openLabel(seg.label, seg.end_ms)));
  }

  for (const cue of manifest.edit_cues) {
    const end = cue.end_ms ?? timelineEnd;
    if (end === null) continue;
    const label = cue.reason ? `${cue.type}: ${cue.reason}` : cue.type;
    lines.push(formatRegion(cue.start_ms, Math.max(end, cue.start_ms), openLabel(label, cue.end_ms)));
  }

  for (const run of runs.slice(1)) {
    const t = formatSeconds(run.timeline_start_ms);
    lines.push(`${t}\t${t}\t\u{23F8} Paused`);
  }

  for (const note of manifest.notes) {
    const start = note.timestamp_ms;
    const end = note.timestamp_ms + 500;
    lines.push(formatRegion(start, end, `\u{1F4DD} ${note.text}`));
  }

  for (const s of manifest.sounders_used) {
    const t = formatSeconds(s.played_at_ms);
    lines.push(`${t}\t${t}\t\u{1F50A} ${s.name}`);
  }

  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

function openLabel(label: string, endMs: number | null): string {
  return endMs === null ? `${label} (not ended)` : label;
}

function formatRegion(startMs: number, endMs: number, label: string): string {
  return `${formatSeconds(startMs)}\t${formatSeconds(endMs)}\t${label}`;
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(6);
}

// ---------------------------------------------------------------------------
// Browser download helpers (client-side only)
// ---------------------------------------------------------------------------

export function downloadManifest(manifest: Manifest): void {
  const json = JSON.stringify(manifest, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload(blob, `${manifest.episode}-session-manifest.json`);
}

export function downloadLabels(manifest: Manifest): void {
  const labels = manifestToAudacityLabels(manifest);
  const blob = new Blob([labels], { type: 'text/plain' });
  triggerDownload(blob, `${manifest.episode}-labels.txt`);
}

export function downloadSessionMergeBundle(
  manifest: Manifest,
  recordings: RecordingUploadMetadata[],
  sounderAssets: SounderAsset[],
): SessionMergeBundle {
  if (!manifest.session_id) {
    throw new Error('Manifest is missing session_id');
  }

  const labels = manifestToAudacityLabels(manifest);
  const labelsFilename = `${manifest.episode}-labels.txt`;
  const mergeWarnings = buildMergeWarnings(manifest, recordings);
  const bundle: SessionMergeBundle = {
    bundle_version: '1.1',
    generated_at: new Date().toISOString(),
    session_id: manifest.session_id,
    episode: manifest.episode,
    manifest,
    labels: {
      format: 'audacity',
      filename: labelsFilename,
      text: labels,
    },
    recordings: placeRecordingsOnTimeline(manifest, recordings),
    sounder_assets: sounderAssets,
    merge_notes: [
      'Download each recordings[].url before merging.',
      'Download each sounder_assets[].downloadUrl for sounder reconstruction.',
      'Place each recording at recordings[].timeline_offset_ms and trim it to timeline_max_duration_ms; paused time is not part of the timeline.',
      'Use labels.text as the Audacity label track contents.',
      ...mergeWarnings,
    ],
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${manifest.episode}-merge-bundle.json`);
  return bundle;
}

export function placeRecordingsOnTimeline(
  manifest: Manifest,
  recordings: RecordingUploadMetadata[],
): MergeBundleRecording[] {
  const runs = manifest.recording_runs ?? [];
  return recordings.map(recording => {
    const placement = runs.length ? uploadTimelinePlacement(runs, recording.startedAt) : null;
    return {
      ...recording,
      timeline_offset_ms: placement?.offsetMs ?? null,
      timeline_max_duration_ms: placement?.maxDurationMs ?? null,
    };
  });
}

function isParticipantUpload(recording: RecordingUploadMetadata, participant: RecordingParticipantInterval): boolean {
  // Uploads saved before they recorded a participant can only match by name.
  return recording.clientId !== null
    ? recording.clientId === participant.client_id
    : recording.hostName === participant.name;
}

export function buildMergeWarnings(manifest: Manifest, recordings: RecordingUploadMetadata[]): string[] {
  const warnings: string[] = [];
  const runs = manifest.recording_runs ?? [];
  const micRecordings = recordings.filter(recording => recording.trackType === 'mic');
  const recordingParticipantIds = new Set(manifest.recording_participants.map(participant => participant.client_id));

  if (runs.length) {
    // Every run a participant recorded in needs that participant's own upload
    // (audit R13): an upload from another run or another person does not count.
    const uploadRuns = micRecordings.map(recording => ({
      recording,
      runIndex: uploadTimelinePlacement(runs, recording.startedAt)?.runIndex ?? null,
    }));
    for (const participant of manifest.recording_participants) {
      const left = participant.left_at_epoch_ms ?? Infinity;
      for (const [runIndex, run] of runs.entries()) {
        const runEnd = run.stopped_at_epoch_ms ?? Infinity;
        const overlaps = participant.joined_at_epoch_ms < runEnd && left > run.started_at_epoch_ms;
        if (!overlaps) continue;
        const found = uploadRuns.some(upload => upload.runIndex === runIndex && isParticipantUpload(upload.recording, participant));
        if (!found) {
          warnings.push(`Warning: participant recording upload missing for ${participant.name} in recording run ${runIndex + 1} of ${runs.length}.`);
        }
      }
    }
    for (const { recording, runIndex } of uploadRuns) {
      if (runIndex === null) {
        warnings.push(`Warning: ${recording.hostName}'s upload starts after the last recording run and cannot be placed.`);
      }
    }
  } else {
    for (const participant of manifest.recording_participants) {
      if (!micRecordings.some(recording => isParticipantUpload(recording, participant))) {
        warnings.push(`Warning: participant recording upload missing for ${participant.name}.`);
      }
    }
  }

  for (const [label, items] of [['segment', manifest.segments], ['edit cue', manifest.edit_cues]] as const) {
    for (const item of items) {
      if (item.end_ms === null) {
        const name = 'label' in item ? item.label : item.type;
        warnings.push(`Warning: ${label} "${name}" was never ended; its label runs to the end of the timeline.`);
      }
    }
  }

  for (const audioParticipant of manifest.audio_participants ?? []) {
    if (!recordingParticipantIds.has(audioParticipant.client_id)) {
      warnings.push(`Warning: ${audioParticipant.name} joined audio but was not recording.`);
    }
    if (audioParticipant.disconnects.length > 0) {
      warnings.push(`Warning: ${audioParticipant.name} had ${audioParticipant.disconnects.length} audio disconnect interval(s).`);
    }
  }

  return Array.from(new Set(warnings));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
