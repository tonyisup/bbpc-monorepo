import { NextRequest, NextResponse } from 'next/server';
import { fetchQuery } from 'convex/nextjs';
import { api } from '../../../../../../convex/_generated/api';
import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { hasSessionAccess } from '@/lib/sessions/store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const grants = readSessionGrantsFromCookieHeader(request.headers.get('cookie') ?? undefined);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);
  const canAccess = await hasSessionAccess(sessionId, grant);

  if (!canAccess) {
    return NextResponse.json({ message: 'Session access denied' }, { status: 403 });
  }

  const recordings = await fetchQuery(api.recordings.listBySession, {
    publicSessionId: sessionId,
    clientId: grant!.clientId,
    accessToken: grant!.accessToken,
  });

  return NextResponse.json({ recordings });
}
