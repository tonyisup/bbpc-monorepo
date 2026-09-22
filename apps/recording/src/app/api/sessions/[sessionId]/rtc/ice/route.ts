import { NextResponse } from 'next/server';
import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { findParticipantForGrant, getSession } from '@/lib/sessions/store';
import { buildIceConfig, parseIceUrls } from '@/lib/rtc/ice';

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const grants = readSessionGrantsFromCookieHeader(request.headers.get('cookie') ?? undefined);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);
  const participant = await findParticipantForGrant(sessionId, grant);

  if (!participant || !grant) {
    return NextResponse.json({ message: 'Session access denied' }, { status: 403 });
  }

  // Participants keep access to an ended session for export, but relay
  // credentials are only for live calls (RTC join and signaling also require
  // an active session).
  const session = await getSession(sessionId, grant);
  if (session?.status !== 'active') {
    return NextResponse.json({ message: 'The recording session has ended' }, { status: 409 });
  }

  const ttlSeconds = Number(process.env.TURN_TTL_SECONDS ?? '3600');
  const response = buildIceConfig({
    clientId: participant.clientId,
    turnUrls: parseIceUrls(process.env.TURN_URLS),
    stunUrls: parseIceUrls(process.env.STUN_URLS),
    staticAuthSecret: process.env.TURN_STATIC_AUTH_SECRET,
    ttlSeconds,
  });

  return NextResponse.json(response);
}
