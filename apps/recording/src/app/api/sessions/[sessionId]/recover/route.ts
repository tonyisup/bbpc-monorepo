import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ConvexError } from 'convex/values';
import { getRequiredConvexToken } from '@/lib/convex/server';
import { recoverOwnerAccess } from '@/lib/sessions/store';
import {
  SESSION_GRANTS_COOKIE,
  readSessionGrantsFromCookieValue,
  sessionGrantCookieOptions,
  upsertSessionGrant,
} from '@/lib/sessions/cookies';

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const sessionUrl = new URL(`/sessions/${encodeURIComponent(sessionId)}`, request.url);
  const failed = (reason: string) => {
    sessionUrl.searchParams.set('recoverError', reason);
    return NextResponse.redirect(sessionUrl, 303);
  };

  let grant: Awaited<ReturnType<typeof recoverOwnerAccess>>;
  try {
    const convexToken = await getRequiredConvexToken();
    if (convexToken === null) return failed('sign-in-required');
    grant = await recoverOwnerAccess(convexToken, sessionId);
  } catch (error) {
    if (error instanceof ConvexError) return failed('not-owner');
    console.error('[Recording Session] Owner access recovery failed:', error);
    return failed('unavailable');
  }

  const cookieStore = await cookies();
  const grants = upsertSessionGrant(
    readSessionGrantsFromCookieValue(cookieStore.get(SESSION_GRANTS_COOKIE)?.value),
    grant,
  );
  const response = NextResponse.redirect(sessionUrl, 303);
  response.cookies.set(
    SESSION_GRANTS_COOKIE,
    Buffer.from(JSON.stringify(grants), 'utf8').toString('base64url'),
    sessionGrantCookieOptions,
  );
  return response;
}
