import type { Manifest, SessionAction, SessionState, SessionSyncEvent, Sounder } from '@/types';

export function createInitialState(
  episode: string,
  date: string,
  hostName: string,
  sounders: Sounder[] = [],
): SessionState {
  return {
    episode,
    date,
    hostName,
    recordingStart: null,
    isRecording: false,
    sounders,
    soundersUsed: [],
    recordingParticipants: [],
    audioParticipants: [],
    notes: [],
    segments: [],
    editCues: [],
  };
}

function msSince(recordingStartedAt: number, timestamp: number): number {
  return Math.max(0, timestamp - recordingStartedAt);
}

function upsertRecordingJoin(
  state: SessionState,
  participant: {
    clientId: string;
    name: string;
    role: 'owner' | 'participant';
    joinedAt: number;
    recordingStartedAt: number;
  },
): SessionState {
  const interval = {
    client_id: participant.clientId,
    name: participant.name,
    role: participant.role,
    joined_at_ms: msSince(participant.recordingStartedAt, participant.joinedAt),
    joined_at_epoch_ms: participant.joinedAt,
    left_at_ms: null,
    left_at_epoch_ms: null,
  };

  const existingOpenIndex = state.recordingParticipants.findIndex(existing => (
    existing.client_id === participant.clientId && existing.left_at_epoch_ms === null
  ));

  if (existingOpenIndex >= 0) {
    return {
      ...state,
      recordingParticipants: state.recordingParticipants.map((existing, index) => (
        index === existingOpenIndex ? { ...existing, ...interval } : existing
      )),
    };
  }

  return {
    ...state,
    recordingParticipants: [...state.recordingParticipants, interval],
  };
}

function applyRecordingLeave(
  state: SessionState,
  participant: {
    clientId: string;
    leftAt: number;
    recordingStartedAt: number;
    reason?: 'left' | 'host-stopped';
  },
): SessionState {
  const existingOpenIndex = state.recordingParticipants.findIndex(existing => (
    existing.client_id === participant.clientId && existing.left_at_epoch_ms === null
  ));

  if (existingOpenIndex < 0) return state;

  return {
    ...state,
    recordingParticipants: state.recordingParticipants.map((existing, index) => (
      index === existingOpenIndex
        ? {
            ...existing,
            left_at_ms: msSince(participant.recordingStartedAt, participant.leftAt),
            left_at_epoch_ms: participant.leftAt,
            leave_reason: participant.reason,
          }
        : existing
    )),
  };
}

function audioMsSince(recordingStartedAt: number | null, timestamp: number): number {
  return recordingStartedAt ? msSince(recordingStartedAt, timestamp) : 0;
}

function upsertAudioJoin(
  state: SessionState,
  participant: {
    clientId: string;
    name: string;
    role: 'owner' | 'participant';
    joinedAudioAt: number;
    recordingStartedAt: number | null;
  },
): SessionState {
  const existingOpenIndex = state.audioParticipants.findIndex(existing => (
    existing.client_id === participant.clientId && existing.left_audio_at_epoch_ms === null
  ));

  const interval = {
    client_id: participant.clientId,
    name: participant.name,
    role: participant.role,
    joined_audio_at_ms: audioMsSince(participant.recordingStartedAt, participant.joinedAudioAt),
    joined_audio_at_epoch_ms: participant.joinedAudioAt,
    left_audio_at_ms: null,
    left_audio_at_epoch_ms: null,
    disconnects: existingOpenIndex >= 0 ? state.audioParticipants[existingOpenIndex].disconnects : [],
  };

  if (existingOpenIndex >= 0) {
    return {
      ...state,
      audioParticipants: state.audioParticipants.map((existing, index) => (
        index === existingOpenIndex ? { ...existing, ...interval } : existing
      )),
    };
  }

  return {
    ...state,
    audioParticipants: [...state.audioParticipants, interval],
  };
}

function applyAudioLeave(
  state: SessionState,
  participant: {
    clientId: string;
    leftAudioAt: number;
    recordingStartedAt: number | null;
  },
): SessionState {
  const existingOpenIndex = state.audioParticipants.findIndex(existing => (
    existing.client_id === participant.clientId && existing.left_audio_at_epoch_ms === null
  ));

  if (existingOpenIndex < 0) return state;

  return {
    ...state,
    audioParticipants: state.audioParticipants.map((existing, index) => (
      index === existingOpenIndex
        ? {
            ...existing,
            left_audio_at_ms: audioMsSince(participant.recordingStartedAt, participant.leftAudioAt),
            left_audio_at_epoch_ms: participant.leftAudioAt,
          }
        : existing
    )),
  };
}

function applyAudioDisconnectStart(
  state: SessionState,
  disconnect: {
    disconnectId: string;
    clientId: string;
    startedAt: number;
    recordingStartedAt: number | null;
    reason: 'ice-disconnected' | 'ice-failed' | 'heartbeat-timeout' | 'page-hidden-timeout';
  },
): SessionState {
  const existingOpenIndex = state.audioParticipants.findIndex(existing => (
    existing.client_id === disconnect.clientId && existing.left_audio_at_epoch_ms === null
  ));

  if (existingOpenIndex < 0) return state;

  return {
    ...state,
    audioParticipants: state.audioParticipants.map((existing, index) => {
      if (index !== existingOpenIndex) return existing;
      if (existing.disconnects.some(item => item.disconnect_id === disconnect.disconnectId)) return existing;

      return {
        ...existing,
        disconnects: [
          ...existing.disconnects,
          {
            disconnect_id: disconnect.disconnectId,
            started_at_ms: audioMsSince(disconnect.recordingStartedAt, disconnect.startedAt),
            started_at_epoch_ms: disconnect.startedAt,
            ended_at_ms: null,
            ended_at_epoch_ms: null,
            reason: disconnect.reason,
          },
        ],
      };
    }),
  };
}

function applyAudioDisconnectEnd(
  state: SessionState,
  disconnect: {
    disconnectId: string;
    clientId: string;
    endedAt: number;
    recordingStartedAt: number | null;
  },
): SessionState {
  return {
    ...state,
    audioParticipants: state.audioParticipants.map(existing => {
      if (existing.client_id !== disconnect.clientId) return existing;

      return {
        ...existing,
        disconnects: existing.disconnects.map(item => (
          item.disconnect_id === disconnect.disconnectId && item.ended_at_epoch_ms === null
            ? {
                ...item,
                ended_at_ms: audioMsSince(disconnect.recordingStartedAt, disconnect.endedAt),
                ended_at_epoch_ms: disconnect.endedAt,
              }
            : item
        )),
      };
    }),
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'START_RECORDING': {
      const startedAt = action.startedAt ?? Date.now();
      const nextState = { ...state, isRecording: true, recordingStart: startedAt };
      if (!action.participant) return nextState;

      return upsertRecordingJoin(nextState, {
        ...action.participant,
        recordingStartedAt: startedAt,
      });
    }

    case 'STOP_RECORDING': {
      const nextState = { ...state, isRecording: false };
      return action.participant ? applyRecordingLeave(nextState, action.participant) : nextState;
    }

    case 'JOIN_RECORDING':
      return upsertRecordingJoin(state, action.participant);

    case 'LEAVE_RECORDING':
      return applyRecordingLeave(state, action.participant);

    case 'JOIN_AUDIO':
      return upsertAudioJoin(state, action.participant);

    case 'LEAVE_AUDIO':
      return applyAudioLeave(state, action.participant);

    case 'START_AUDIO_DISCONNECT':
      return applyAudioDisconnectStart(state, action.disconnect);

    case 'END_AUDIO_DISCONNECT':
      return applyAudioDisconnectEnd(state, action.disconnect);

    case 'TRIGGER_SOUNDER': {
      const playedAt = action.played_at_ms ?? (state.recordingStart != null ? Date.now() - state.recordingStart : 0);
      return {
        ...state,
        soundersUsed: [
          ...state.soundersUsed,
          {
            id: action.sounder.id,
            name: action.sounder.name,
            played_at_ms: playedAt,
            played_by: action.played_by ?? state.hostName,
          },
        ],
      };
    }

    case 'ADD_NOTE':
      return { ...state, notes: [...state.notes, action.note] };

    case 'DELETE_NOTE':
      return { ...state, notes: state.notes.filter(n => n.id !== action.id) };

    case 'START_SEGMENT':
      return { ...state, segments: [...state.segments, action.segment] };

    case 'END_SEGMENT':
      return {
        ...state,
        segments: state.segments.map(seg => (
          seg.id === action.id ? { ...seg, end_ms: action.end_ms } : seg
        )),
      };

    case 'ADD_EDIT_CUE':
      return { ...state, editCues: [...state.editCues, action.cue] };

    case 'UPDATE_EDIT_CUE':
      return {
        ...state,
        editCues: state.editCues.map(cue => (
          cue.id === action.id ? { ...cue, end_ms: action.end_ms } : cue
        )),
      };

    case 'DELETE_EDIT_CUE':
      return { ...state, editCues: state.editCues.filter(c => c.id !== action.id) };

    case 'DELETE_SEGMENT':
      return { ...state, segments: state.segments.filter(seg => seg.id !== action.id) };

    case 'UPDATE_EPISODE':
      return { ...state, episode: action.episode };

    case 'UPDATE_HOST_NAME':
      return { ...state, hostName: action.hostName };

    case 'RESET':
      return { ...createInitialState(state.episode, state.date, state.hostName, state.sounders) };

    default:
      return state;
  }
}

export function actionToSyncEvent(
  action: SessionAction,
  hostName: string,
  recordingStart: number | null,
  clientEventSourceId: string,
): SessionSyncEvent | null {
  switch (action.type) {
    case 'TRIGGER_SOUNDER': {
      const playedAt = recordingStart != null ? Date.now() - recordingStart : 0;
      return {
        kind: 'sounder',
        sounder: action.sounder,
        played_at_ms: playedAt,
        played_by: hostName,
        from: clientEventSourceId,
      };
    }
    case 'ADD_NOTE':
      return { kind: 'note', note: action.note, from: clientEventSourceId };
    case 'DELETE_NOTE':
      return { kind: 'note-delete', id: action.id, from: clientEventSourceId };
    case 'JOIN_RECORDING':
      return { kind: 'recording-joined', participant: action.participant, from: clientEventSourceId };
    case 'LEAVE_RECORDING':
      return { kind: 'recording-left', participant: action.participant, from: clientEventSourceId };
    case 'JOIN_AUDIO':
      return { kind: 'audio-joined', participant: action.participant, from: clientEventSourceId };
    case 'LEAVE_AUDIO':
      return { kind: 'audio-left', participant: action.participant, from: clientEventSourceId };
    case 'START_AUDIO_DISCONNECT':
      return { kind: 'audio-disconnect-started', disconnect: action.disconnect, from: clientEventSourceId };
    case 'END_AUDIO_DISCONNECT':
      return { kind: 'audio-disconnect-ended', disconnect: action.disconnect, from: clientEventSourceId };
    case 'START_SEGMENT':
      return { kind: 'segment-start', segment: action.segment, from: clientEventSourceId };
    case 'END_SEGMENT':
      return { kind: 'segment-end', id: action.id, end_ms: action.end_ms, from: clientEventSourceId };
    case 'DELETE_SEGMENT':
      return { kind: 'segment-delete', id: action.id, from: clientEventSourceId };
    case 'UPDATE_EPISODE':
      return { kind: 'episode-update', episode: action.episode, from: clientEventSourceId };
    case 'ADD_EDIT_CUE':
      return { kind: 'edit-cue', cue: action.cue, from: clientEventSourceId };
    case 'UPDATE_EDIT_CUE':
      return { kind: 'edit-cue-update', id: action.id, end_ms: action.end_ms, from: clientEventSourceId };
    case 'DELETE_EDIT_CUE':
      return { kind: 'edit-cue-delete', id: action.id, from: clientEventSourceId };
    default:
      return null;
  }
}

export function syncEventToAction(event: SessionSyncEvent): SessionAction | null {
  switch (event.kind) {
    case 'sounder':
      return {
        type: 'TRIGGER_SOUNDER',
        sounder: event.sounder,
        played_at_ms: event.played_at_ms,
        played_by: event.played_by,
      };
    case 'note':
      return { type: 'ADD_NOTE', note: event.note };
    case 'note-delete':
      return { type: 'DELETE_NOTE', id: event.id };
    case 'recording-started':
      return {
        type: 'START_RECORDING',
        startedAt: event.startedAt,
        participant: event.participant,
      };
    case 'recording-stopped':
      return {
        type: 'STOP_RECORDING',
        participant: event.participant
          ? {
              clientId: event.participant.clientId,
              leftAt: event.participant.leftAt,
              recordingStartedAt: event.startedAt,
              reason: event.participant.reason,
            }
          : undefined,
      };
    case 'recording-joined':
      return { type: 'JOIN_RECORDING', participant: event.participant };
    case 'recording-left':
      return { type: 'LEAVE_RECORDING', participant: event.participant };
    case 'audio-joined':
      return { type: 'JOIN_AUDIO', participant: event.participant };
    case 'audio-left':
      return { type: 'LEAVE_AUDIO', participant: event.participant };
    case 'audio-disconnect-started':
      return { type: 'START_AUDIO_DISCONNECT', disconnect: event.disconnect };
    case 'audio-disconnect-ended':
      return { type: 'END_AUDIO_DISCONNECT', disconnect: event.disconnect };
    case 'segment-start':
      return { type: 'START_SEGMENT', segment: event.segment };
    case 'segment-end':
      return { type: 'END_SEGMENT', id: event.id, end_ms: event.end_ms };
    case 'segment-delete':
      return { type: 'DELETE_SEGMENT', id: event.id };
    case 'episode-update':
      return { type: 'UPDATE_EPISODE', episode: event.episode };
    case 'edit-cue':
      return { type: 'ADD_EDIT_CUE', cue: event.cue };
    case 'edit-cue-update':
      return { type: 'UPDATE_EDIT_CUE', id: event.id, end_ms: event.end_ms };
    case 'edit-cue-delete':
      return { type: 'DELETE_EDIT_CUE', id: event.id };
    default:
      return null;
  }
}

export function applySessionSyncEvents(
  initialState: SessionState,
  events: SessionSyncEvent[],
): SessionState {
  return events.reduce((state, event) => {
    const action = syncEventToAction(event);
    return action ? sessionReducer(state, action) : state;
  }, initialState);
}

export function sessionStateToManifest(
  state: SessionState,
  sessionId: string,
  elapsedMs: number,
): Manifest {
  return {
    episode: state.episode,
    date: state.date,
    hosts: [state.hostName],
    session_id: sessionId,
    recording_start: state.recordingStart,
    recording_end: state.isRecording ? null : (state.recordingStart ?? 0) + elapsedMs,
    manifest_version: '1.1',
    recording_participants: state.recordingParticipants,
    audio_participants: state.audioParticipants,
    sounders_used: state.soundersUsed,
    notes: state.notes,
    segments: state.segments,
    edit_cues: state.editCues,
  };
}
