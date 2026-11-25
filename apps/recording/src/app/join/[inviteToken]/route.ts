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

type InviteContext = { params: Promise<{ inviteToken: string }> };

const INVALID_INVITE = 'Invite link is invalid or expired.';
const UNAVAILABLE = 'This recording session cannot accept guests right now.';

// Opening the link only shows this page. Joining adds a participant, and a
// session has a fixed number of places, so it waits for a person to press
// Join: link previews, chat unfurlers and crawlers only ever GET.
const JOIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Join recording session</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
    font-family: ui-sans-serif, system-ui, sans-serif; background: hsl(220 15% 8%); color: hsl(220 15% 85%); }
  main { max-width: 360px; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: hsl(220 15% 60%); line-height: 1.5; }
  button { font: inherit; font-weight: 600; padding: 10px 24px; border-radius: 8px; border: 0; cursor: pointer;
    background: hsl(220 80% 65%); color: hsl(220 15% 8%); }
  button:hover { background: hsl(220 80% 70%); }
</style>
</head>
<body>
<main>
  <h1>You're invited to a recording session</h1>
  <p>Joining lets the host record you. You'll be asked for microphone access when audio starts.</p>
  <form method="post"><button type="submit">Join session</button></form>
</main>
</body>
</html>`;

async function existingMembership(inviteToken: string) {
  const cookieStore = await cookies();
  const existingGrants = readSessionGrantsFromCookieValue(cookieStore.get(SESSION_GRANTS_COOKIE)?.value);
  const invitedSessionId = await resolveInviteSession(inviteToken);
  if (invitedSessionId === null) return { invitedSessionId, existingGrants, member: false };

  // Reopening an invite (including the owner testing their own link) keeps
  // the membership this browser already has instead of adding a participant.
  // A grant the backend rejects is replaced by joining; any other failure is
  // surfaced rather than risking an owner's grant.
  const existingGrant = existingGrants.find(grant => grant.sessionId === invitedSessionId);
  const member = !!existingGrant && !!await findParticipantForGrant(invitedSessionId, existingGrant);
  return { invitedSessionId, existingGrants, member };
}

export async function GET(request: Request, context: InviteContext) {
  const { inviteToken } = await context.params;
  try {
    const { invitedSessionId, member } = await existingMembership(inviteToken);
    if (invitedSessionId === null) return new Response(INVALID_INVITE, { status: 404 });
    if (member) return NextResponse.redirect(new URL(`/sessions/${invitedSessionId}`, request.url));
  } catch (error) {
    console.error('[Recording Session] Invite lookup failed:', error);
    return new Response(UNAVAILABLE, { status: 503 });
  }
  return new Response(JOIN_PAGE, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function POST(request: Request, context: InviteContext) {
  const { inviteToken } = await context.params;
  // Only this app's own join page may add a participant.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return new Response('Cross-site join refused.', { status: 403 });
  }

  let existingGrants: Awaited<ReturnType<typeof existingMembership>>['existingGrants'];
  let result: Awaited<ReturnType<typeof joinSessionByInviteToken>>;
  try {
    const membership = await existingMembership(inviteToken);
    if (membership.invitedSessionId === null) return new Response(INVALID_INVITE, { status: 404 });
    // 303: the browser follows a POST's redirect with a GET.
    if (membership.member) {
      return NextResponse.redirect(new URL(`/sessions/${membership.invitedSessionId}`, request.url), 303);
    }
    existingGrants = membership.existingGrants;
    result = await joinSessionByInviteToken(inviteToken);
  } catch (error) {
    console.error('[Recording Session] Invite join failed:', error);
    return new Response(UNAVAILABLE, { status: 503 });
  }

  if (!result) {
    return new Response(INVALID_INVITE, { status: 404 });
  }

  const grants = upsertSessionGrant(existingGrants, result.grant);
  const response = NextResponse.redirect(new URL(`/sessions/${result.session.id}`, request.url), 303);

  response.cookies.set(
    SESSION_GRANTS_COOKIE,
    Buffer.from(JSON.stringify(grants), 'utf8').toString('base64url'),
    sessionGrantCookieOptions,
  );

  return response;
}
