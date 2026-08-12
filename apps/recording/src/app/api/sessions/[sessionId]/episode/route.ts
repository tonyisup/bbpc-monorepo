import { NextResponse } from 'next/server';
import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { updateSessionEpisode } from '@/lib/sessions/store';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const { episode } = await request.json() as { episode?: string };
  const grants = readSessionGrantsFromCookieHeader(request.headers.get('cookie') ?? undefined);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);
  const trimmed = episode?.trim();

  if (!grant) {
    return NextResponse.json({ message: 'Session access denied' }, { status: 403 });
  }

  if (!trimmed) {
    return NextResponse.json({ message: 'Missing episode' }, { status: 400 });
  }

  const session = await updateSessionEpisode(sessionId, grant, trimmed);
  if (!session) {
    return NextResponse.json({ message: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({ session });
}

