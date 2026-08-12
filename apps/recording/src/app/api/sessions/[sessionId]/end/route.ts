import { NextRequest, NextResponse } from 'next/server';
import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { endSession } from '@/lib/sessions/store';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const grants = readSessionGrantsFromCookieHeader(request.headers.get('cookie') ?? undefined);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);
  const session = await endSession(sessionId, grant);

  if (!session) {
    return NextResponse.json({ message: 'Session owner access required' }, { status: 403 });
  }

  return NextResponse.json({ session });
}
