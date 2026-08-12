import { NextResponse } from 'next/server';
import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { updateParticipantDisplayName } from '@/lib/sessions/store';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const { displayName } = await request.json() as { displayName?: string };
  const grants = readSessionGrantsFromCookieHeader(request.headers.get('cookie') ?? undefined);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);

  if (!grant) {
    return NextResponse.json({ message: 'Session access denied' }, { status: 403 });
  }

  if (!displayName?.trim()) {
    return NextResponse.json({ message: 'Missing displayName' }, { status: 400 });
  }

  const participant = await updateParticipantDisplayName(sessionId, grant, displayName);
  if (!participant) {
    return NextResponse.json({ message: 'Participant not found' }, { status: 404 });
  }

  return NextResponse.json({ participant });
}
