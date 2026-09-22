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

// Browsers reject a whole cookie over about 4 KB, which would also lose the
// grant being added (audit R12). Leave room for the name and attributes.
export const MAX_GRANTS_COOKIE_VALUE_LENGTH = 3_800;

/**
 * Adds or replaces a session's grant, newest last. When the cookie would grow
 * too large, the oldest guest grants go first, then the oldest owner grants
 * (which carry the invite token); the new grant is always kept. A dropped
 * grant cannot be recovered in that browser.
 */
export function upsertSessionGrant(
  grants: SessionAccessGrant[],
  grant: SessionAccessGrant,
): SessionAccessGrant[] {
  const next = [
    ...grants.filter(existing => existing.sessionId !== grant.sessionId),
    grant,
  ];
  while (next.length > 1 && encodeGrants(next).length > MAX_GRANTS_COOKIE_VALUE_LENGTH) {
    const oldestGuest = next.findIndex((existing, index) => index < next.length - 1 && existing.inviteToken === undefined);
    next.splice(oldestGuest >= 0 ? oldestGuest : 0, 1);
  }
  return next;
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
