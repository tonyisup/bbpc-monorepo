import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSession } from '@/lib/sessions/store';
import {
  SESSION_GRANTS_COOKIE,
  readSessionGrantsFromCookieValue,
  sessionGrantCookieOptions,
  upsertSessionGrant,
} from '@/lib/sessions/cookies';

export async function POST(request: Request) {
  const { session, grant } = await createSession();
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
