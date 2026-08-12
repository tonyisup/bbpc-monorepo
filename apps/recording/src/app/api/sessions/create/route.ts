import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSession } from '@/lib/sessions/store';
import {
  SESSION_GRANTS_COOKIE,
  readSessionGrantsFromCookieValue,
  sessionGrantCookieOptions,
  upsertSessionGrant,
} from '@/lib/sessions/cookies';
import { getRequiredConvexToken } from '@/lib/convex/server';

export async function POST(request: Request) {
  let result: Awaited<ReturnType<typeof createSession>>;
  try {
    const convexToken = await getRequiredConvexToken();
    if (convexToken === null) {
      return NextResponse.redirect(
        new URL('/?createError=sign-in-required', request.url),
        303,
      );
    }
    result = await createSession(convexToken);
  } catch (error) {
    console.error('[Recording Session] Creation failed:', error);
    return NextResponse.redirect(
      new URL('/?createError=unavailable', request.url),
      303,
    );
  }
  const { session, grant } = result;
  const cookieStore = await cookies();
  const grants = upsertSessionGrant(
    readSessionGrantsFromCookieValue(cookieStore.get(SESSION_GRANTS_COOKIE)?.value),
    grant,
  );
  const url = new URL(`/sessions/${session.id}`, request.url);
  const response = NextResponse.redirect(url, 303);

  response.cookies.set(
    SESSION_GRANTS_COOKIE,
    Buffer.from(JSON.stringify(grants), 'utf8').toString('base64url'),
    sessionGrantCookieOptions,
  );

  return response;
}
