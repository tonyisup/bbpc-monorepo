// --- Session Manifest Types ---

export interface Sounder {
  id: string;
  name: string;
  category: string;
  duration: number; // ms
  url: string;
}

export interface SounderAsset {
  id: string;
  blobName: string;
  name: string;
  category: string;
  url: string;
  downloadUrl: string;
  duration: number;
  size: number;
  contentType: string;
}

export interface EditCue {
  id: string;
  start_ms: number;
  end_ms: number | null;
  type: 'doxx-bleep' | 'network-drop' | 'dmca-music' | 'spoiler' | 'other';
  reason?: string;
  author?: string;
}

export interface SessionNote {
  id: string;
  timestamp_ms: number;
  text: string;
  author: string;
}

export interface Segment {
  id: string;
  start_ms: number;
  end_ms: number | null;
  type: 'intro' | 'segment' | 'ad' | 'outro' | 'news' | 'interview';
  label: string;
}

export interface SegmentTemplate {
  id: string;
  label: string;
  type: Segment['type'];
  introSounder?: string;
  outroSounder?: string;
  sortOrder?: number;
}

export interface RecordingParticipantInterval {
  client_id: string;
  name: string;
  role: 'owner' | 'participant';
  joined_at_ms: number;
  joined_at_epoch_ms: number;
  left_at_ms: number | null;
  left_at_epoch_ms: number | null;
  leave_reason?: 'left' | 'host-stopped';
}

export type AudioDisconnectReason =
  | 'ice-disconnected'
  | 'ice-failed'
  | 'heartbeat-timeout'
  | 'page-hidden-timeout'
  | 'left';

export interface AudioParticipantInterval {
  client_id: string;
  name: string;
  role: 'owner' | 'participant';
  joined_audio_at_ms: number;
  joined_audio_at_epoch_ms: number;
  left_audio_at_ms: number | null;
  left_audio_at_epoch_ms: number | null;
  disconnects: Array<{
    disconnect_id: string;
    started_at_ms: number;
    started_at_epoch_ms: number;
    ended_at_ms: number | null;
    ended_at_epoch_ms: number | null;
    reason: AudioDisconnectReason;
  }>;
}

export type RtcSignalType = 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'renegotiate';

export interface RtcPresence {
  clientId: string;
  displayName: string;
  role: 'owner' | 'participant';
  joinedAudioAt: number;
  lastSeenAt: number;
  muted: boolean;
  recording: boolean;
}

export interface RtcSignal {
  fromClientId: string;
  toClientId: string;
  signalId: string;
  createdAt: number;
  type: RtcSignalType;
  payload: unknown;
}

export interface RecordingUploadMetadata {
  id: string;
  publicSessionId?: string;
  episode: string;
  hostName: string;
  trackType: 'mic' | 'sounders';
  startedAt: number;
  blobName: string;
  url: string;
  size: number;
  contentType: string;
  uploadedAt: number;
}

export interface Manifest {
  session_id?: string;
  episode: string;
  date: string;
  hosts: string[];
  recording_start: number | null;
  recording_end: number | null;
  manifest_version: '1.1';
  recording_participants: RecordingParticipantInterval[];
  audio_participants: AudioParticipantInterval[];
  sounders_used: Array<{ id: string; name: string; played_at_ms: number; played_by: string }>;
  notes: SessionNote[];
  segments: Segment[];
  edit_cues: EditCue[];
}

export interface SessionMergeBundle {
  bundle_version: '1.0';
  generated_at: string;
  session_id: string;
  episode: string;
  manifest: Manifest;
  labels: {
    format: 'audacity';
    filename: string;
    text: string;
  };
  recordings: RecordingUploadMetadata[];
  sounder_assets: SounderAsset[];
  merge_notes: string[];
}

// --- Session State (runtime, in-memory) ---

export interface SessionState {
  episode: string;
  date: string;
  hostName: string;
  recordingStart: number | null; // Date.now() when recording started, null if not started
  isRecording: boolean;
  sounders: Sounder[];
  soundersUsed: Manifest['sounders_used'];
  recordingParticipants: RecordingParticipantInterval[];
  audioParticipants: AudioParticipantInterval[];
  notes: SessionNote[];
  segments: Segment[];
  editCues: EditCue[];
}

export type SessionAction =
  | {
      type: 'START_RECORDING';
      startedAt?: number;
      participant?: {
        clientId: string;
        name: string;
        role: 'owner' | 'participant';
        joinedAt: number;
      };
    }
  | {
      type: 'STOP_RECORDING';
      participant?: {
        clientId: string;
        leftAt: number;
        recordingStartedAt: number;
        reason: 'host-stopped';
      };
    }
  | {
      type: 'JOIN_RECORDING';
      participant: {
        clientId: string;
        name: string;
        role: 'owner' | 'participant';
        joinedAt: number;
        recordingStartedAt: number;
      };
    }
  | {
      type: 'LEAVE_RECORDING';
      participant: {
        clientId: string;
        leftAt: number;
        recordingStartedAt: number;
        reason?: 'left' | 'host-stopped';
      };
    }
  | {
      type: 'JOIN_AUDIO';
      participant: {
        clientId: string;
        name: string;
        role: 'owner' | 'participant';
        joinedAudioAt: number;
        recordingStartedAt: number | null;
      };
    }
  | {
      type: 'LEAVE_AUDIO';
      participant: {
        clientId: string;
        leftAudioAt: number;
        recordingStartedAt: number | null;
      };
    }
  | {
      type: 'START_AUDIO_DISCONNECT';
      disconnect: {
        disconnectId: string;
        clientId: string;
        startedAt: number;
        recordingStartedAt: number | null;
        reason: Exclude<AudioDisconnectReason, 'left'>;
      };
    }
  | {
      type: 'END_AUDIO_DISCONNECT';
      disconnect: {
        disconnectId: string;
        clientId: string;
        endedAt: number;
        recordingStartedAt: number | null;
      };
    }
  | { type: 'TRIGGER_SOUNDER'; sounder: Sounder; played_at_ms?: number; played_by?: string }
  | { type: 'ADD_NOTE'; note: SessionNote }
  | { type: 'DELETE_NOTE'; id: string }
  | { type: 'START_SEGMENT'; segment: Segment }
  | { type: 'END_SEGMENT'; id: string; end_ms: number }
  | { type: 'ADD_EDIT_CUE'; cue: EditCue }
  | { type: 'UPDATE_EDIT_CUE'; id: string; end_ms: number }
  | { type: 'DELETE_EDIT_CUE'; id: string }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'UPDATE_EPISODE'; episode: string }
  | { type: 'UPDATE_HOST_NAME'; hostName: string }
  | { type: 'RESET' }

// --- Realtime Session Event Types ---

export interface SessionSyncSounderEvent {
  kind: 'sounder';
  sounder: Sounder;
  played_at_ms: number;
  played_by: string;
  from?: string;
}

export interface SessionSyncNoteEvent {
  kind: 'note';
  note: SessionNote;
  from?: string;
}

export interface SessionSyncNoteDeleteEvent {
  kind: 'note-delete';
  id: string;
  from?: string;
}

export interface SessionSyncSegmentStartEvent {
  kind: 'segment-start';
  segment: Segment;
  from?: string;
}

export interface SessionSyncSegmentEndEvent {
  kind: 'segment-end';
  id: string;
  end_ms: number;
  from?: string;
}

export interface SessionSyncEditCueEvent {
  kind: 'edit-cue';
  cue: EditCue;
  from?: string;
}

export interface SessionSyncEditCueUpdateEvent {
  kind: 'edit-cue-update';
  id: string;
  end_ms: number;
  from?: string;
}

export interface SessionSyncEditCueDeleteEvent {
  kind: 'edit-cue-delete';
  id: string;
  from?: string;
}

export interface SessionSyncSegmentDeleteEvent {
  kind: 'segment-delete';
  id: string;
  from?: string;
}

export interface SessionSyncRecordingStartEvent {
  kind: 'recording-started';
  startedAt: number;
  startedByRole?: 'owner';
  participant?: {
    clientId: string;
    name: string;
    role: 'owner';
    joinedAt: number;
  };
  from?: string;
}

export interface SessionSyncRecordingStopEvent {
  kind: 'recording-stopped';
  startedAt: number;
  durationMs: number;
  stoppedByRole?: 'owner';
  participant?: {
    clientId: string;
    leftAt: number;
    reason: 'host-stopped';
  };
  from?: string;
}

export interface SessionSyncRecordingJoinEvent {
  kind: 'recording-joined';
  participant: {
    clientId: string;
    name: string;
    role: 'owner' | 'participant';
    joinedAt: number;
    recordingStartedAt: number;
  };
  from?: string;
}

export interface SessionSyncRecordingLeaveEvent {
  kind: 'recording-left';
  participant: {
    clientId: string;
    leftAt: number;
    recordingStartedAt: number;
    reason?: 'left' | 'host-stopped';
  };
  from?: string;
}

export interface SessionSyncEpisodeUpdateEvent {
  kind: 'episode-update';
  episode: string;
  from?: string;
}

export interface SessionSyncAudioJoinEvent {
  kind: 'audio-joined';
  participant: {
    clientId: string;
    name: string;
    role: 'owner' | 'participant';
    joinedAudioAt: number;
    recordingStartedAt: number | null;
  };
  from?: string;
}

export interface SessionSyncAudioLeaveEvent {
  kind: 'audio-left';
  participant: {
    clientId: string;
    leftAudioAt: number;
    recordingStartedAt: number | null;
  };
  from?: string;
}

export interface SessionSyncAudioDisconnectStartEvent {
  kind: 'audio-disconnect-started';
  disconnect: {
    disconnectId: string;
    clientId: string;
    startedAt: number;
    recordingStartedAt: number | null;
    reason: Exclude<AudioDisconnectReason, 'left'>;
  };
  from?: string;
}

export interface SessionSyncAudioDisconnectEndEvent {
  kind: 'audio-disconnect-ended';
  disconnect: {
    disconnectId: string;
    clientId: string;
    endedAt: number;
    recordingStartedAt: number | null;
  };
  from?: string;
}

// All events that affect session state
export type SessionSyncStateEvent =
  | SessionSyncSounderEvent
  | SessionSyncRecordingJoinEvent
  | SessionSyncRecordingLeaveEvent
  | SessionSyncAudioJoinEvent
  | SessionSyncAudioLeaveEvent
  | SessionSyncAudioDisconnectStartEvent
  | SessionSyncAudioDisconnectEndEvent
  | SessionSyncNoteEvent
  | SessionSyncNoteDeleteEvent
  | SessionSyncSegmentStartEvent
  | SessionSyncSegmentEndEvent
  | SessionSyncSegmentDeleteEvent
  | SessionSyncEpisodeUpdateEvent
  | SessionSyncEditCueEvent
  | SessionSyncEditCueUpdateEvent
  | SessionSyncEditCueDeleteEvent;

// All realtime events (session + recording sync)
export type SessionSyncEvent =
  | SessionSyncStateEvent
  | SessionSyncRecordingStartEvent
  | SessionSyncRecordingStopEvent;
