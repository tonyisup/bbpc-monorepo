import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert/strict';
import { manifestToAudacityLabels } from '@/lib/export-labels';
import type { Manifest } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  const recordingParticipants = overrides.recording_participants ?? [];
  const audioParticipants = overrides.audio_participants ?? [];

  return {
    episode: 'EP-2026-01',
    date: '2026-01-15',
    hosts: ['tony', 'fonso', 'harley'],
    recording_start: 0,
    recording_end: 7200000,
    manifest_version: '1.1',
    sounders_used: [],
    notes: [],
    segments: [],
    edit_cues: [],
    ...overrides,
    recording_participants: recordingParticipants,
    audio_participants: audioParticipants,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('manifestToAudacityLabels', () => {

  it('returns empty string for empty manifest', () => {
    const result = manifestToAudacityLabels(baseManifest());
    assert.equal(result, '');
  });

  it('formats segments as region labels', () => {
    const m = baseManifest({
      segments: [
        { id: 'seg-1', start_ms: 0, end_ms: 120000, type: 'intro', label: 'Opening Theme' },
        { id: 'seg-2', start_ms: 120000, end_ms: 180000, type: 'segment', label: 'News' },
      ],
    });
    const lines = manifestToAudacityLabels(m).trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], '0.000000\t120.000000\tOpening Theme');
    assert.equal(lines[1], '120.000000\t180.000000\tNews');
  });

  it('skips segments with null end_ms', () => {
    const m = baseManifest({
      segments: [
        { id: 'seg-1', start_ms: 0, end_ms: null, type: 'intro', label: 'Open-ended' },
        { id: 'seg-2', start_ms: 0, end_ms: 60000, type: 'segment', label: 'Closed' },
      ],
    });
    const lines = manifestToAudacityLabels(m).trimEnd().split('\n');
    assert.equal(lines.length, 1);
    assert.ok(lines[0].endsWith('Closed'));
  });

  it('formats edit cues as region labels with type prefix', () => {
    const m = baseManifest({
      edit_cues: [
        { id: 'edit-1', start_ms: 245000, end_ms: 252000, type: 'doxx-bleep', reason: 'address drop', author: 'tony' },
        { id: 'edit-2', start_ms: 300000, end_ms: 305000, type: 'network-drop' },
      ],
    });
    const lines = manifestToAudacityLabels(m).trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0], '245.000000\t252.000000\tdoxx-bleep: address drop');
    assert.equal(lines[1], '300.000000\t305.000000\tnetwork-drop');
  });

  it('skips edit cues with null end_ms', () => {
    const m = baseManifest({
      edit_cues: [
        { id: 'edit-1', start_ms: 1000, end_ms: null, type: 'spoiler', reason: 'not closed' },
      ],
    });
    assert.equal(manifestToAudacityLabels(m), '');
  });

  it('formats notes as 0.5s point labels with 📝 prefix', () => {
    const m = baseManifest({
      notes: [
        { id: 'note-1', timestamp_ms: 5240, text: 'Bob had feedback', author: 'tony' },
      ],
    });
    const result = manifestToAudacityLabels(m).trimEnd();
    assert.equal(result, '5.240000\t5.740000\t\u{1F4DD} Bob had feedback');
  });

  it('formats sounders as zero-width point labels with 🔊 prefix', () => {
    const m = baseManifest({
      sounders_used: [
        { id: 'theme-intro', name: 'Theme Song Intro', played_at_ms: 10000, played_by: 'tony' },
      ],
    });
    const result = manifestToAudacityLabels(m).trimEnd();
    assert.equal(result, '10.000000\t10.000000\t\u{1F50A} Theme Song Intro');
  });

  it('outputs segments, then edit cues, then notes, then sounders', () => {
    const m = baseManifest({
      sounders_used: [
        { id: 's1', name: 'S', played_at_ms: 5000, played_by: 'tony' },
      ],
      notes: [
        { id: 'n1', timestamp_ms: 3000, text: 'Note', author: 'fonso' },
      ],
      segments: [
        { id: 'seg-1', start_ms: 0, end_ms: 1000, type: 'intro', label: 'Seg' },
      ],
      edit_cues: [
        { id: 'e1', start_ms: 2000, end_ms: 2500, type: 'doxx-bleep', reason: 'x', author: 'harley' },
      ],
    });
    const lines = manifestToAudacityLabels(m).trimEnd().split('\n');
    assert.equal(lines.length, 4);
    assert.ok(lines[0].startsWith('0.000000') && lines[0].endsWith('Seg'));
    assert.ok(lines[1].startsWith('2.000000') && lines[1].endsWith('doxx-bleep: x'));
    assert.ok(lines[2].startsWith('3.000000') && lines[2].includes('Note'));
    assert.ok(lines[3].startsWith('5.000000') && lines[3].endsWith('S'));
  });

  it('uses tab separation and 6-decimal precision', () => {
    const m = baseManifest({
      segments: [
        { id: 'seg-1', start_ms: 123456, end_ms: 789012, type: 'segment', label: 'Test' },
      ],
    });
    const result = manifestToAudacityLabels(m).trimEnd();
    assert.equal(result, '123.456000\t789.012000\tTest');
    const cols = result.split('\t');
    assert.equal(cols.length, 3);
  });

  it('handles a realistic mixed manifest', () => {
    const m: Manifest = {
      episode: 'EP-2026-06-09',
      date: '2026-06-09',
      hosts: ['tony', 'fonso', 'harley'],
      recording_start: 0,
      recording_end: 7200000,
      manifest_version: '1.1',
      recording_participants: [],
      audio_participants: [],
      sounders_used: [
        { id: 'theme-intro', name: 'Theme Song Intro', played_at_ms: 10000, played_by: 'tony' },
        { id: 'laugh-01', name: 'Laugh 01', played_at_ms: 45230, played_by: 'fonso' },
      ],
      notes: [
        { id: 'note-1', timestamp_ms: 5240, text: 'Bob intro had feedback', author: 'tony' },
        { id: 'note-2', timestamp_ms: 120000, text: 'Segment transition felt rushed', author: 'harley' },
      ],
      segments: [
        { id: 'seg-1', start_ms: 0, end_ms: 120000, type: 'intro', label: 'Opening Theme' },
        { id: 'seg-2', start_ms: 120000, end_ms: 180000, type: 'news', label: 'News' },
        { id: 'seg-3', start_ms: 180000, end_ms: null, type: 'segment', label: 'Discussion' },
      ],
      edit_cues: [
        { id: 'edit-1', start_ms: 245000, end_ms: 252000, type: 'doxx-bleep', reason: 'address drop', author: 'tony' },
        { id: 'edit-2', start_ms: 300000, end_ms: 305000, type: 'network-drop' },
      ],
    };

    const output = manifestToAudacityLabels(m);
    const lines = output.trimEnd().split('\n');

    // 2 segments (3rd is null end_ms) + 2 edit cues + 2 notes + 2 sounders = 8
    assert.equal(lines.length, 8);

    // Verify segment lines
    assert.ok(lines[0].includes('Opening Theme'));
    assert.ok(lines[1].includes('News'));

    // Verify edit cue lines
    assert.ok(lines[2].includes('doxx-bleep: address drop'));
    assert.ok(lines[3].includes('network-drop'));

    // Verify note lines
    assert.ok(lines[4].includes('Bob intro had feedback'));
    assert.ok(lines[5].includes('Segment transition felt rushed'));

    // Verify sounder lines
    assert.ok(lines[6].includes('Theme Song Intro'));
    assert.ok(lines[7].includes('Laugh 01'));
  });
});
