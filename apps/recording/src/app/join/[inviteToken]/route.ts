import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  findParticipantForGrant,
  joinSessionByInviteToken,
  resolveInviteSession,
} from '@/lib/sessions/store';
import {
  SESSION_GRANTS_COOKIE,
  readSessionGrantsFromCookieValue,
  sessionGrantCookieOptions,
  upsertSessionGrant,
} from '@/lib/sessions/cookies';

export async function GET(
  request: Request,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const { inviteToken } = await context.params;
  const cookieStore = await cookies();
  const existingGrants = readSessionGrantsFromCookieValue(cookieStore.get(SESSION_GRANTS_COOKIE)?.value);

  let result: Awaited<ReturnType<typeof joinSessionByInviteToken>>;
  try {
    const invitedSessionId = await resolveInviteSession(inviteToken);
    if (invitedSessionId === null) {
      return new Response('Invite link is invalid or expired.', { status: 404 });
    }

    // Reopening an invite (including the owner testing their own link) keeps
    // the membership this browser already has instead of adding a participant.
    // A grant the backend rejects is replaced by joining; any other failure is
    // surfaced rather than risking an owner's grant.
    const existingGrant = existingGrants.find(grant => grant.sessionId === invitedSessionId);
    if (existingGrant && await findParticipantForGrant(invitedSessionId, existingGrant)) {
      return NextResponse.redirect(new URL(`/sessions/${invitedSessionId}`, request.url));
    }

    result = await joinSessionByInviteToken(inviteToken);
  } catch (error) {
    console.error('[Recording Session] Invite join failed:', error);
    return new Response(
      'This recording session cannot accept guests right now.',
      { status: 503 },
    );
  }

  if (!result) {
    return new Response('Invite link is invalid or expired.', { status: 404 });
  }

  const grants = upsertSessionGrant(existingGrants, result.grant);
  const response = NextResponse.redirect(new URL(`/sessions/${result.session.id}`, request.url));

  response.cookies.set(
    SESSION_GRANTS_COOKIE,
    Buffer.from(JSON.stringify(grants), 'utf8').toString('base64url'),
    sessionGrantCookieOptions,
  );

  return response;
}
