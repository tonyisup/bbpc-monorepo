import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import {
  mutateSharedConvex,
  mutateSharedConvexAsUser,
  querySharedConvex,
} from '@/lib/convex/http';
import {
  createAccessToken,
  createClientId,
  createInviteToken,
  createSessionId,
} from './ids';
import type {
  CreateSessionResult,
  AuthenticatedSessionParticipant,
  JoinSessionResult,
  RecordingSession,
  SessionAccessGrant,
  SessionLifecycle,
} from './types';

function sanitizeDisplayName(displayName: string | undefined, fallback: string): string {
  const normalized = displayName?.trim().replace(/\s+/g, ' ');
  if (!normalized) return fallback;
  return normalized.slice(0, 40);
}

function defaultEpisode(): string {
  return `EP-${new Date().toISOString().slice(0, 10)}`;
}

export async function createSession(
  convexToken: string,
  displayName?: string,
): Promise<CreateSessionResult> {
  const now = Date.now();
  const clientId = createClientId();
  const accessToken = createAccessToken();
  const inviteToken = createInviteToken();
  const participant = {
    clientId,
    accessToken,
    displayName: sanitizeDisplayName(displayName, 'Host'),
    joinedAt: now,
  };

  const session = await mutateSharedConvexAsUser(
    recordingApi.sessions.createSession,
    {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicId: createSessionId(),
      inviteToken,
      episode: defaultEpisode(),
      createdAt: now,
      participant,
    },
    convexToken,
  );

  return {
    session,
    grant: {
      sessionId: session.id,
      clientId,
      accessToken,
      inviteToken,
    },
  };
}

export async function getSession(
  sessionId: string,
  grant: SessionAccessGrant,
): Promise<RecordingSession | null> {
  return await querySharedConvex(recordingApi.sessions.getSession, {
    publicId: sessionId,
    clientId: grant.clientId,
    accessToken: grant.accessToken,
  });
}

export async function joinSessionByInviteToken(
  inviteToken: string,
  displayName?: string,
): Promise<JoinSessionResult | null> {
  const now = Date.now();
  const participant = {
    clientId: createClientId(),
    accessToken: createAccessToken(),
    displayName: sanitizeDisplayName(displayName, 'Guest'),
    joinedAt: now,
  };

  const session = await mutateSharedConvex(
    recordingApi.sessions.joinSessionByInviteToken,
    {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      inviteToken,
      participant,
    },
  );

  if (!session) return null;

  return {
    session,
    participant: {
      ...participant,
      role: 'participant',
      joinedAt: new Date(participant.joinedAt).toISOString(),
    },
    grant: {
      sessionId: session.id,
      clientId: participant.clientId,
      accessToken: participant.accessToken,
    },
  };
}

export async function hasSessionAccess(
  sessionId: string,
  grant: SessionAccessGrant | undefined,
): Promise<boolean> {
  return (await getParticipantForGrant(sessionId, grant)) !== null;
}

export async function getParticipantForGrant(
  sessionId: string,
  grant: SessionAccessGrant | undefined,
): Promise<AuthenticatedSessionParticipant | null> {
  if (!grant || grant.sessionId !== sessionId) return null;

  const participant = await querySharedConvex(
    recordingApi.sessions.getParticipantForGrant,
    {
      publicId: sessionId,
      clientId: grant.clientId,
      accessToken: grant.accessToken,
    },
  );
  return participant === null
    ? null
    : {
        ...participant,
        accessToken: grant.accessToken,
      };
}

export async function updateParticipantDisplayName(
  sessionId: string,
  grant: SessionAccessGrant,
  displayName: string,
): Promise<AuthenticatedSessionParticipant | null> {
  const participant = await mutateSharedConvex(
    recordingApi.sessions.updateParticipantDisplayName,
    {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicId: sessionId,
      clientId: grant.clientId,
      accessToken: grant.accessToken,
      displayName: sanitizeDisplayName(displayName, 'Guest'),
    },
  );
  return {
    ...participant,
    accessToken: grant.accessToken,
  };
}

export async function updateSessionEpisode(
  sessionId: string,
  grant: SessionAccessGrant | undefined,
  episode: string,
): Promise<{ id: string; episode: string } | null> {
  if (!grant) return null;
  const participant = await getParticipantForGrant(sessionId, grant);
  if (!participant || participant.role !== 'owner') return null;

  return await mutateSharedConvex(
    recordingApi.sessions.updateSessionEpisode,
    {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicId: sessionId,
      clientId: grant.clientId,
      accessToken: grant.accessToken,
      episode: episode.trim().slice(0, 80),
    },
  );
}

export async function endSession(
  sessionId: string,
  grant: SessionAccessGrant | undefined,
): Promise<SessionLifecycle | null> {
  if (!grant) return null;
  const participant = await getParticipantForGrant(sessionId, grant);
  if (!participant || participant.role !== 'owner') return null;

  return await mutateSharedConvex(recordingApi.sessions.endSession, {
    clientApiVersion: BBPC_CLIENT_API_VERSION,
    publicId: sessionId,
    clientId: grant.clientId,
    accessToken: grant.accessToken,
  });
}
