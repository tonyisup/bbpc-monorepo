import 'server-only';

import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { getParticipantForGrant } from '@/lib/sessions/store';
import type { AuthenticatedSessionParticipant, SessionAccessGrant } from '@/lib/sessions/types';

/** The participant a request's session grant authenticates, or null. */
export async function recordingParticipantFor(
  request: Request,
  sessionId: string,
): Promise<{ grant: SessionAccessGrant; participant: AuthenticatedSessionParticipant } | null> {
  const grant = readSessionGrantsFromCookieHeader(request.headers.get('cookie') ?? undefined)
    .find(candidate => candidate.sessionId === sessionId);
  if (!grant) return null;
  try {
    const participant = await getParticipantForGrant(sessionId, grant);
    return participant ? { grant, participant } : null;
  } catch {
    return null;
  }
}
