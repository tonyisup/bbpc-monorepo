export type SessionRole = 'owner' | 'participant';
export type SessionStatus = 'active' | 'ended';

export interface SessionParticipant {
  clientId: string;
  displayName: string;
  role: SessionRole;
  joinedAt: string;
}

export interface AuthenticatedSessionParticipant extends SessionParticipant {
  accessToken: string;
}

export interface RecordingSession {
  id: string;
  inviteToken: string;
  episode: string;
  createdAt: string;
  endedAt?: string | null;
  status: SessionStatus;
  participants: SessionParticipant[];
}

export interface SessionAccessGrant {
  sessionId: string;
  clientId: string;
  accessToken: string;
}

export interface CreateSessionResult {
  session: RecordingSession;
  grant: SessionAccessGrant;
}

export interface JoinSessionResult {
  session: RecordingSession;
  participant: AuthenticatedSessionParticipant;
  grant: SessionAccessGrant;
}
