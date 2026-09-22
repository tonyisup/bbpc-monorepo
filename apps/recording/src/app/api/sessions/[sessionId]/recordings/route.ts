import { NextRequest, NextResponse } from 'next/server';
import { readSessionGrantsFromCookieHeader } from '@/lib/sessions/cookies';
import { hasSessionAccess } from '@/lib/sessions/store';
import { recordingApi } from '@/lib/convex/api';
import { querySharedConvex } from '@/lib/convex/http';
import { signedRecordingUrl } from '@/lib/recordings/storage';

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

  const recordings = await querySharedConvex(recordingApi.recordings.listBySession, {
    publicSessionId: sessionId,
    clientId: grant!.clientId,
    accessToken: grant!.accessToken,
  });

  // Stored URLs are unsigned and stop working once the container is private.
  try {
    const signed = await Promise.all(recordings.map(async recording => {
      const { url, expiresAt } = await signedRecordingUrl(recording.blobName);
      return { ...recording, url, urlExpiresAt: expiresAt };
    }));
    return NextResponse.json({ recordings: signed });
  } catch (error) {
    console.error('[Recording Session] Could not sign recording URLs:', error);
    return NextResponse.json({ message: 'Recording links are unavailable' }, { status: 503 });
  }
}
