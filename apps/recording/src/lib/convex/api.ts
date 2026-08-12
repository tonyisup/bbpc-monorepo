import { makeFunctionReference } from 'convex/server';

import { BBPC_API_VERSION } from '@tonyisup/bbpc-convex-api/contracts';

import type {
  Manifest,
  RecordingUploadMetadata,
  RtcPresence,
  RtcSignal,
  SegmentTemplate,
  SessionSyncEvent,
  Sounder,
} from '@/types';
import type {
  RecordingSession,
  SessionLifecycle,
  SessionParticipant,
} from '@/lib/sessions/types';

export const BBPC_CLIENT_API_VERSION = BBPC_API_VERSION;

type CapabilityArgs = {
  publicSessionId: string;
  clientId: string;
  accessToken: string;
};

type SessionCapabilityArgs = {
  publicId: string;
  clientId: string;
  accessToken: string;
};

type ParticipantInput = {
  clientId: string;
  accessToken: string;
  displayName: string;
  joinedAt: number;
};

type SounderCatalogItem = Sounder & {
  blobName: string;
  size: number;
  contentType: string;
};

const sessions = {
  createSession: makeFunctionReference<
    'mutation',
    {
      clientApiVersion: string;
      publicId: string;
      inviteToken: string;
      episodeId?: string;
      episode: string;
      createdAt: number;
      participant: ParticipantInput;
    },
    RecordingSession
  >('recording/sessions:createSession'),
  joinSessionByInviteToken: makeFunctionReference<
    'mutation',
    {
      clientApiVersion: string;
      inviteToken: string;
      participant: ParticipantInput;
    },
    RecordingSession | null
  >('recording/sessions:joinSessionByInviteToken'),
  getSession: makeFunctionReference<
    'query',
    SessionCapabilityArgs,
    RecordingSession | null
  >('recording/sessions:getSession'),
  getSessionLifecycle: makeFunctionReference<
    'query',
    SessionCapabilityArgs,
    SessionLifecycle | null
  >('recording/sessions:getSessionLifecycle'),
  getParticipantForGrant: makeFunctionReference<
    'query',
    SessionCapabilityArgs,
    SessionParticipant | null
  >('recording/sessions:getParticipantForGrant'),
  updateParticipantDisplayName: makeFunctionReference<
    'mutation',
    SessionCapabilityArgs & {
      clientApiVersion: string;
      displayName: string;
    },
    SessionParticipant
  >('recording/sessions:updateParticipantDisplayName'),
  updateSessionEpisode: makeFunctionReference<
    'mutation',
    SessionCapabilityArgs & {
      clientApiVersion: string;
      episode: string;
      episodeId?: string | null;
    },
    SessionLifecycle
  >('recording/sessions:updateSessionEpisode'),
  endSession: makeFunctionReference<
    'mutation',
    SessionCapabilityArgs & { clientApiVersion: string },
    SessionLifecycle
  >('recording/sessions:endSession'),
  listParticipants: makeFunctionReference<
    'query',
    SessionCapabilityArgs,
    Array<{ id: string; name: string }>
  >('recording/sessions:listParticipants'),
  appendSessionEvent: makeFunctionReference<
    'mutation',
    SessionCapabilityArgs & {
      clientApiVersion: string;
      eventId: string;
      createdAt: number;
      payload: SessionSyncEvent;
    },
    string
  >('recording/sessions:appendSessionEvent'),
  listSessionEvents: makeFunctionReference<
    'query',
    SessionCapabilityArgs,
    Array<{
      eventId: string;
      actorId: string;
      createdAt: number;
      payload: SessionSyncEvent;
    }>
  >('recording/sessions:listSessionEvents'),
  cleanupEndedSessions: makeFunctionReference<
    'mutation',
    {
      clientApiVersion: string;
      olderThan: number;
      limit?: number;
      confirmation: 'delete-ended-sessions';
    },
    {
      sessions: number;
      invites: number;
      participants: number;
      rtcPresence: number;
      rtcSignals: number;
      events: number;
      manifests: number;
      favorites: number;
      recordings: number;
    }
  >('recording/sessions:cleanupEndedSessions'),
};

const favorites = {
  list: makeFunctionReference<
    'query',
    CapabilityArgs,
    Sounder[]
  >('recording/favorites:list'),
  replaceAll: makeFunctionReference<
    'mutation',
    CapabilityArgs & {
      clientApiVersion: string;
      favorites: Sounder[];
      updatedAt: number;
    },
    { count: number }
  >('recording/favorites:replaceAll'),
};

const manifests = {
  getBySession: makeFunctionReference<
    'query',
    CapabilityArgs,
    {
      publicSessionId: string;
      episode: string;
      date: string;
      hosts: string[];
      manifestVersion: string;
      manifest: Manifest;
      updatedAt: number;
    } | null
  >('recording/manifests:getBySession'),
  save: makeFunctionReference<
    'mutation',
    CapabilityArgs & {
      clientApiVersion: string;
      episode: string;
      date: string;
      hosts: string[];
      manifestVersion: string;
      manifest: Manifest;
      updatedAt: number;
    },
    string
  >('recording/manifests:save'),
};

const recordings = {
  listBySession: makeFunctionReference<
    'query',
    CapabilityArgs,
    RecordingUploadMetadata[]
  >('recording/recordings:listBySession'),
  saveUpload: makeFunctionReference<
    'mutation',
    CapabilityArgs & {
      clientApiVersion: string;
      episode: string;
      hostName: string;
      trackType: 'mic' | 'sounders';
      startedAt: number;
      blobName: string;
      url: string;
      size: number;
      contentType: string;
      uploadedAt: number;
    },
    string
  >('recording/recordings:saveUpload'),
};

const sounders = {
  list: makeFunctionReference<
    'query',
    Record<string, never>,
    SounderCatalogItem[]
  >('recording/sounders:list'),
  replaceAll: makeFunctionReference<
    'mutation',
    {
      clientApiVersion: string;
      sounders: SounderCatalogItem[];
      updatedAt: number;
    },
    { count: number }
  >('recording/sounders:replaceAll'),
};

const templates = {
  list: makeFunctionReference<
    'query',
    Record<string, never>,
    Array<
      Omit<SegmentTemplate, 'introSounder' | 'outroSounder'> & {
        introSounder: string | null;
        outroSounder: string | null;
        sortOrder: number;
      }
    >
  >('recording/templates:list'),
  upsertMany: makeFunctionReference<
    'mutation',
    {
      clientApiVersion: string;
      templates: SegmentTemplate[];
      updatedAt: number;
    },
    { count: number }
  >('recording/templates:upsertMany'),
};

const rtc = {
  joinAudio: makeFunctionReference<
    'mutation',
    CapabilityArgs & {
      clientApiVersion: string;
      muted: boolean;
      recording: boolean;
    },
    { ok: true } | { ok: false; reason: 'room-full' }
  >('recording/rtc:joinAudio'),
  leaveAudio: makeFunctionReference<
    'mutation',
    CapabilityArgs & { clientApiVersion: string },
    { ok: true }
  >('recording/rtc:leaveAudio'),
  heartbeatAudio: makeFunctionReference<
    'mutation',
    CapabilityArgs & {
      clientApiVersion: string;
      muted: boolean;
      recording: boolean;
    },
    { ok: true } | null
  >('recording/rtc:heartbeatAudio'),
  listAudioPresence: makeFunctionReference<
    'query',
    CapabilityArgs,
    RtcPresence[]
  >('recording/rtc:listAudioPresence'),
  sendSignal: makeFunctionReference<
    'mutation',
    CapabilityArgs & {
      clientApiVersion: string;
      toClientId: string;
      signalId: string;
      type: RtcSignal['type'];
      payload: unknown;
    },
    { ok: true } | null
  >('recording/rtc:sendSignal'),
  listSignalsForParticipant: makeFunctionReference<
    'query',
    CapabilityArgs & { now: number },
    RtcSignal[]
  >('recording/rtc:listSignalsForParticipant'),
};

export const recordingApi = {
  sessions,
  favorites,
  manifests,
  recordings,
  sounders,
  templates,
  rtc,
};

export type { SounderCatalogItem };
