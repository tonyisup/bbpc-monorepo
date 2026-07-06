import { describe, it } from 'vitest';
import { strict as assert } from 'assert';
import {
  applySessionSyncEvents,
  createInitialState,
  sessionReducer,
  syncEventToAction,
} from './session-state';
import type { SessionSyncEvent, Sounder } from '@/types';

const sounder: Sounder = {
  id: 's1',
  name: 'Intro Sting',
  category: 'Intros',
  duration: 1200,
  url: '/api/sounders/play?path=intro.mp3',
};

describe('session event replay', () => {
  it('rebuilds notes, cues, segments, sounders, and episode title from events', () => {
    const initial = createInitialState('EP-OLD', '2026-06-23', 'Harley');
    const events: SessionSyncEvent[] = [
      { kind: 'episode-update', episode: 'EP-NEW', from: 'host' },
      {
        kind: 'note',
        from: 'host',
        note: { id: 'n1', timestamp_ms: 1000, text: 'Fix cold open', author: 'Harley' },
      },
      {
        kind: 'edit-cue',
        from: 'host',
        cue: { id: 'c1', start_ms: 2000, end_ms: null, type: 'other', reason: 'tighten', author: 'Harley' },
      },
      { kind: 'edit-cue-update', id: 'c1', end_ms: 3000, from: 'host' },
      {
        kind: 'segment-start',
        from: 'host',
        segment: { id: 'seg1', start_ms: 4000, end_ms: null, type: 'segment', label: 'News' },
      },
      { kind: 'segment-end', id: 'seg1', end_ms: 9000, from: 'host' },
      {
        kind: 'sounder',
        sounder,
        played_at_ms: 5000,
        played_by: 'Tony',
        from: 'host',
      },
    ];

    const state = applySessionSyncEvents(initial, events);

    assert.equal(state.episode, 'EP-NEW');
    assert.equal(state.notes.length, 1);
    assert.equal(state.notes[0].text, 'Fix cold open');
    assert.equal(state.editCues[0].end_ms, 3000);
    assert.equal(state.segments[0].end_ms, 9000);
    assert.deepEqual(state.soundersUsed[0], {
      id: 's1',
      name: 'Intro Sting',
      played_at_ms: 5000,
      played_by: 'Tony',
    });
  });

  it('replays delete events', () => {
    const initial = createInitialState('EP', '2026-06-23', 'Harley');
    const state = applySessionSyncEvents(initial, [
      { kind: 'note', note: { id: 'n1', timestamp_ms: 1, text: 'remove me', author: 'Harley' } },
      { kind: 'note-delete', id: 'n1' },
      { kind: 'segment-start', segment: { id: 'seg1', start_ms: 1, end_ms: null, type: 'intro', label: 'Intro' } },
      { kind: 'segment-delete', id: 'seg1' },
      { kind: 'edit-cue', cue: { id: 'c1', start_ms: 1, end_ms: null, type: 'other', author: 'Harley' } },
      { kind: 'edit-cue-delete', id: 'c1' },
    ]);

    assert.equal(state.notes.length, 0);
    assert.equal(state.segments.length, 0);
    assert.equal(state.editCues.length, 0);
  });

  it('applies recording transport events to session state for manifest replay', () => {
    assert.deepEqual(syncEventToAction({
      kind: 'recording-started',
      startedAt: 1000,
      startedByRole: 'owner',
      participant: {
        clientId: 'host-1',
        name: 'Host',
        role: 'owner',
        joinedAt: 1000,
      },
    }), {
      type: 'START_RECORDING',
      startedAt: 1000,
      participant: {
        clientId: 'host-1',
        name: 'Host',
        role: 'owner',
        joinedAt: 1000,
      },
    });
    assert.deepEqual(syncEventToAction({
      kind: 'recording-stopped',
      startedAt: 1000,
      durationMs: 456,
      stoppedByRole: 'owner',
      participant: {
        clientId: 'host-1',
        leftAt: 1456,
        reason: 'host-stopped',
      },
    }), {
      type: 'STOP_RECORDING',
      participant: {
        clientId: 'host-1',
        leftAt: 1456,
        recordingStartedAt: 1000,
        reason: 'host-stopped',
      },
    });
  });

  it('replays recording participant join and leave intervals', () => {
    const initial = createInitialState('EP', '2026-06-23', 'Harley');
    const state = applySessionSyncEvents(initial, [
      {
        kind: 'recording-started',
        startedAt: 1000,
        startedByRole: 'owner',
        participant: {
          clientId: 'host-1',
          name: 'Host',
          role: 'owner',
          joinedAt: 1000,
        },
      },
      {
        kind: 'recording-joined',
        participant: {
          clientId: 'guest-1',
          name: 'Guest',
          role: 'participant',
          joinedAt: 2500,
          recordingStartedAt: 1000,
        },
      },
      {
        kind: 'recording-left',
        participant: {
          clientId: 'guest-1',
          leftAt: 5500,
          recordingStartedAt: 1000,
          reason: 'left',
        },
      },
      {
        kind: 'recording-stopped',
        startedAt: 1000,
        durationMs: 6000,
        stoppedByRole: 'owner',
        participant: {
          clientId: 'host-1',
          leftAt: 7000,
          reason: 'host-stopped',
        },
      },
    ]);

    assert.equal(state.isRecording, false);
    assert.deepEqual(state.recordingParticipants, [
      {
        client_id: 'host-1',
        name: 'Host',
        role: 'owner',
        joined_at_ms: 0,
        joined_at_epoch_ms: 1000,
        left_at_ms: 6000,
        left_at_epoch_ms: 7000,
        leave_reason: 'host-stopped',
      },
      {
        client_id: 'guest-1',
        name: 'Guest',
        role: 'participant',
        joined_at_ms: 1500,
        joined_at_epoch_ms: 2500,
        left_at_ms: 4500,
        left_at_epoch_ms: 5500,
        leave_reason: 'left',
      },
    ]);
  });

  it('replays audio participant intervals and disconnects', () => {
    const initial = createInitialState('EP', '2026-06-23', 'Harley');
    const state = applySessionSyncEvents(initial, [
      {
        kind: 'audio-joined',
        participant: {
          clientId: 'guest-1',
          name: 'Guest',
          role: 'participant',
          joinedAudioAt: 1200,
          recordingStartedAt: 1000,
        },
      },
      {
        kind: 'audio-disconnect-started',
        disconnect: {
          disconnectId: 'disc-1',
          clientId: 'guest-1',
          startedAt: 2500,
          recordingStartedAt: 1000,
          reason: 'ice-disconnected',
        },
      },
      {
        kind: 'audio-disconnect-ended',
        disconnect: {
          disconnectId: 'disc-1',
          clientId: 'guest-1',
          endedAt: 4000,
          recordingStartedAt: 1000,
        },
      },
      {
        kind: 'audio-left',
        participant: {
          clientId: 'guest-1',
          leftAudioAt: 6000,
          recordingStartedAt: 1000,
        },
      },
    ]);

    assert.deepEqual(state.audioParticipants, [
      {
        client_id: 'guest-1',
        name: 'Guest',
        role: 'participant',
        joined_audio_at_ms: 200,
        joined_audio_at_epoch_ms: 1200,
        left_audio_at_ms: 5000,
        left_audio_at_epoch_ms: 6000,
        disconnects: [
          {
            disconnect_id: 'disc-1',
            started_at_ms: 1500,
            started_at_epoch_ms: 2500,
            ended_at_ms: 3000,
            ended_at_epoch_ms: 4000,
            reason: 'ice-disconnected',
          },
        ],
      },
    ]);
  });

  it('dedupes repeated audio disconnect starts', () => {
    const initial = createInitialState('EP', '2026-06-23', 'Harley');
    const state = applySessionSyncEvents(initial, [
      {
        kind: 'audio-joined',
        participant: {
          clientId: 'guest-1',
          name: 'Guest',
          role: 'participant',
          joinedAudioAt: 1000,
          recordingStartedAt: 1000,
        },
      },
      {
        kind: 'audio-disconnect-started',
        disconnect: {
          disconnectId: 'disc-1',
          clientId: 'guest-1',
          startedAt: 2000,
          recordingStartedAt: 1000,
          reason: 'heartbeat-timeout',
        },
      },
      {
        kind: 'audio-disconnect-started',
        disconnect: {
          disconnectId: 'disc-1',
          clientId: 'guest-1',
          startedAt: 2000,
          recordingStartedAt: 1000,
          reason: 'heartbeat-timeout',
        },
      },
    ]);

    assert.equal(state.audioParticipants[0].disconnects.length, 1);
  });

  it('preserves explicit sounder timestamps when reducing an action', () => {
    const initial = createInitialState('EP', '2026-06-23', 'Harley');
    const state = sessionReducer(initial, {
      type: 'TRIGGER_SOUNDER',
      sounder,
      played_at_ms: 12345,
      played_by: 'Tony',
    });

    assert.equal(state.soundersUsed[0].played_at_ms, 12345);
    assert.equal(state.soundersUsed[0].played_by, 'Tony');
  });
});
