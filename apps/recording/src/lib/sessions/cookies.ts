import type { IncomingMessage, ServerResponse } from 'http';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { SessionAccessGrant } from './types';

export const SESSION_GRANTS_COOKIE = 'bbpc-session-grants';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const sessionGrantCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
} as const;

function encodeGrants(grants: SessionAccessGrant[]): string {
  return Buffer.from(JSON.stringify(grants), 'utf8').toString('base64url');
}

function decodeGrants(value: string | undefined): SessionAccessGrant[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((grant): grant is SessionAccessGrant => (
      grant != null
      && typeof grant.sessionId === 'string'
      && typeof grant.clientId === 'string'
      && typeof grant.accessToken === 'string'
      && (
        grant.inviteToken === undefined
        || typeof grant.inviteToken === 'string'
      )
    ));
  } catch {
    return [];
  }
}

export function readSessionGrantsFromCookieValue(value: string | undefined): SessionAccessGrant[] {
  return decodeGrants(value);
}

export function upsertSessionGrant(
  grants: SessionAccessGrant[],
  grant: SessionAccessGrant,
): SessionAccessGrant[] {
  return [
    ...grants.filter(existing => existing.sessionId !== grant.sessionId),
    grant,
  ];
}

export function serializeSessionGrantsCookie(grants: SessionAccessGrant[]): string {
  const attrs = [
    `${SESSION_GRANTS_COOKIE}=${encodeGrants(grants)}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
    'HttpOnly',
  ];

  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure');
  }

  return attrs.join('; ');
}

export function readSessionGrantsFromCookieHeader(rawCookie: string | undefined): SessionAccessGrant[] {
  if (!rawCookie) return [];

  const cookie = rawCookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_GRANTS_COOKIE}=`));

  if (!cookie) return [];
  return decodeGrants(decodeURIComponent(cookie.slice(SESSION_GRANTS_COOKIE.length + 1)));
}

export function readSessionGrantsFromRequest(req: IncomingMessage | NextApiRequest): SessionAccessGrant[] {
  return readSessionGrantsFromCookieHeader(req.headers.cookie);
}

export function writeSessionGrantCookie(
  req: NextApiRequest,
  res: NextApiResponse | ServerResponse,
  grant: SessionAccessGrant,
): void {
  const grants = upsertSessionGrant(readSessionGrantsFromRequest(req), grant);
  res.setHeader('Set-Cookie', serializeSessionGrantsCookie(grants));
}
