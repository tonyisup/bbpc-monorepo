import { NextResponse } from 'next/server';

import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';
import {
  mutateSharedConvexAsUser,
} from '@/lib/convex/http';
import { getRequiredConvexToken } from '@/lib/convex/server';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as {
    days?: number;
    limit?: number;
    confirmation?: string;
  } | null;
  if (
    input?.confirmation !== 'delete-ended-sessions'
    || !Number.isSafeInteger(input.days)
    || (input.days ?? 0) < 1
    || !Number.isSafeInteger(input.limit)
    || (input.limit ?? 0) < 1
    || (input.limit ?? 0) > 100
  ) {
    return NextResponse.json(
      { message: 'A valid retention window, batch limit, and confirmation are required.' },
      { status: 400 },
    );
  }

  try {
    const token = await getRequiredConvexToken();
    if (token === null) {
      return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
    }
    const result = await mutateSharedConvexAsUser(
      recordingApi.sessions.cleanupEndedSessions,
      {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        olderThan: Date.now() - input.days! * DAY_MS,
        limit: input.limit,
        confirmation: 'delete-ended-sessions',
      },
      token,
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Recording Admin] Session cleanup failed:', error);
    return NextResponse.json(
      { message: 'Session cleanup was not permitted or failed.' },
      { status: 409 },
    );
  }
}
