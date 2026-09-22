import { describe, expect, it } from 'vitest';

import { buildMergeWarnings, manifestToAudacityLabels, placeRecordingsOnTimeline } from './export-labels';
import { applySessionSyncEvents, createInitialState, sessionReducer, sessionStateToManifest } from './session-state';
import {
  startRecordingRun,
  stopRecordingRun,
  timelineLengthMs,
  timelineMsAt,
  uploadTimelinePlacement,
} from './session-timeline';
import type { RecordingUploadMetadata, SessionSyncEvent } from '@/types';

// Audit R04: two two-second takes starting at 1000 and 4000, one second apart.
const twoRuns = stopRecordingRun(
  startRecordingRun(stopRecordingRun(startRecordingRun([], 1_000), 3_000), 4_000),
  6_000,
);

describe('session timeline', () => {
  it('excludes paused time and resumes where it stopped', () => {
    expect(twoRuns).toEqual([
      { started_at_epoch_ms: 1_000, stopped_at_epoch_ms: 3_000, timeline_start_ms: 0 },
      { started_at_epoch_ms: 4_000, stopped_at_epoch_ms: 6_000, timeline_start_ms: 2_000 },
    ]);
    expect(timelineMsAt(twoRuns, 1_500)).toBe(500);
    expect(timelineMsAt(twoRuns, 3_500)).toBe(2_000); // paused: frozen at the pause point
    expect(timelineMsAt(twoRuns, 4_500)).toBe(2_500);
    expect(timelineMsAt(twoRuns, 9_000)).toBe(4_000);
    expect(timelineLengthMs(twoRuns, 9_000)).toBe(4_000);
  });

  it('keeps a replayed start idempotent and closes a run left open by a lost stop', () => {
    const open = startRecordingRun([], 1_000);
    expect(startRecordingRun(open, 1_000)).toBe(open);
    expect(startRecordingRun(open, 5_000)).toEqual([
      { started_at_epoch_ms: 1_000, stopped_at_epoch_ms: 5_000, timeline_start_ms: 0 },
      { started_at_epoch_ms: 5_000, stopped_at_epoch_ms: null, timeline_start_ms: 4_000 },
    ]);
  });

  it('places uploads by run and bounds them to their run', () => {
    expect(uploadTimelinePlacement(twoRuns, 1_000)).toEqual({ runIndex: 0, offsetMs: 0, maxDurationMs: 2_000 });
    expect(uploadTimelinePlacement(twoRuns, 4_000)).toEqual({ runIndex: 1, offsetMs: 2_000, maxDurationMs: 2_000 });
    // A guest who joined half a second into the second run.
    expect(uploadTimelinePlacement(twoRuns, 4_500)).toEqual({ runIndex: 1, offsetMs: 2_500, maxDurationMs: 1_500 });
    // A slightly early guest clock lands at its run's start, not in the pause.
    expect(uploadTimelinePlacement(twoRuns, 3_900)).toEqual({ runIndex: 1, offsetMs: 2_000, maxDurationMs: 2_000 });
    expect(uploadTimelinePlacement(twoRuns, 7_000)).toBeNull();
  });
});

const host = { clientId: 'client_host', name: 'Host', role: 'owner' as const };
const events: SessionSyncEvent[] = [
  { kind: 'recording-started', startedAt: 1_000, startedByRole: 'owner', participant: { ...host, joinedAt: 1_000 } },
  { kind: 'recording-stopped', startedAt: 1_000, durationMs: 2_000, stoppedByRole: 'owner', participant: { clientId: host.clientId, leftAt: 3_000, reason: 'host-stopped' } },
  { kind: 'recording-started', startedAt: 4_000, startedByRole: 'owner', participant: { ...host, joinedAt: 4_000 } },
  { kind: 'recording-stopped', startedAt: 4_000, durationMs: 2_000, stoppedByRole: 'owner', participant: { clientId: host.clientId, leftAt: 6_000, reason: 'host-stopped' } },
];

function upload(startedAt: number): RecordingUploadMetadata {
  return {
    id: `upload-${startedAt}`,
    publicSessionId: 'sess_timeline',
    clientId: host.clientId,
    episode: 'EP',
    hostName: host.name,
    trackType: 'mic',
    startedAt,
    blobName: `sess_timeline/${startedAt}/Host-${host.clientId}-mic.webm`,
    url: `https://audio.example.test/${startedAt}.webm`,
    size: 1,
    contentType: 'audio/webm',
    uploadedAt: startedAt + 2_000,
  };
}

describe('two-run session export', () => {
  const manifest = sessionStateToManifest(applySessionSyncEvents(createInitialState('EP', '2026-09-22', 'Host'), events), 'sess_timeline');

  it('keeps one origin and records both runs', () => {
    expect(manifest.manifest_version).toBe('1.2');
    expect(manifest.recording_start).toBe(1_000);
    expect(manifest.recording_end).toBe(6_000);
    expect(manifest.recording_runs).toEqual(twoRuns);
    expect(manifest.recording_participants.map(p => [p.joined_at_ms, p.left_at_ms])).toEqual([[0, 2_000], [2_000, 4_000]]);
  });

  it('places the second take after the first instead of on top of it', () => {
    const placed = placeRecordingsOnTimeline(manifest, [upload(1_000), upload(4_000)]);
    expect(placed.map(r => [r.timeline_offset_ms, r.timeline_max_duration_ms])).toEqual([[0, 2_000], [2_000, 2_000]]);
    expect(buildMergeWarnings(manifest, [upload(1_000), upload(4_000)])).toEqual([]);
  });

  it('reports a missing take by participant and run even when a same-name upload exists', () => {
    // Audit R13: the first run's upload used to satisfy the check by display name.
    expect(buildMergeWarnings(manifest, [upload(1_000)])).toEqual([
      'Warning: participant recording upload missing for Host in recording run 2 of 2.',
    ]);
    expect(buildMergeWarnings(manifest, [{ ...upload(4_000), clientId: 'client_someone_else' }, upload(1_000)])).toEqual([
      'Warning: participant recording upload missing for Host in recording run 2 of 2.',
    ]);
  });

  it('labels the pause and keeps markers made while paused at the pause point', () => {
    let state = applySessionSyncEvents(createInitialState('EP', '2026-09-22', 'Host'), events.slice(0, 2));
    state = sessionReducer(state, {
      type: 'START_SEGMENT',
      segment: { id: 'seg', start_ms: 500, end_ms: null, type: 'news', label: 'News' },
    });
    // Audit R09: ending a marker while stopped used to produce end 0 before start 500.
    state = sessionReducer(state, { type: 'END_SEGMENT', id: 'seg', end_ms: timelineLengthMs(state.recordingRuns, 99_000) });
    state = applySessionSyncEvents(state, events.slice(2));
    const labels = manifestToAudacityLabels(sessionStateToManifest(state, 'sess_timeline'));
    expect(labels.split('\n')).toContain('0.500000\t2.000000\tNews');
    expect(labels.split('\n')).toContain('2.000000\t2.000000\t\u{23F8} Paused');
  });

  it('clamps a range that would end before it starts', () => {
    let state = createInitialState('EP', '2026-09-22', 'Host');
    state = sessionReducer(state, { type: 'ADD_EDIT_CUE', cue: { id: 'cue', start_ms: 900, end_ms: null, type: 'other' } });
    state = sessionReducer(state, { type: 'UPDATE_EDIT_CUE', id: 'cue', end_ms: 0 });
    expect(state.editCues[0].end_ms).toBe(900);
  });

  it('exports open markers to the end of the timeline and warns about them', () => {
    const open = {
      ...manifest,
      segments: [{ id: 'seg', start_ms: 1_000, end_ms: null, type: 'news' as const, label: 'News' }],
    };
    expect(manifestToAudacityLabels(open).split('\n')).toContain('1.000000\t4.000000\tNews (not ended)');
    expect(buildMergeWarnings(open, [upload(1_000), upload(4_000)])).toEqual([
      'Warning: segment "News" was never ended; its label runs to the end of the timeline.',
    ]);
  });
});
