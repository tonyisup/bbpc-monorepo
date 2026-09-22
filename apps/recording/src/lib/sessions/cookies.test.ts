import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  MAX_GRANTS_COOKIE_VALUE_LENGTH,
  readSessionGrantsFromCookieHeader,
  readSessionGrantsFromCookieValue,
  serializeSessionGrantsCookie,
  upsertSessionGrant,
} from './cookies';
import { createAccessToken, createClientId, createInviteToken, createSessionId } from './ids';
import type { SessionAccessGrant } from './types';

const ownerGrant: SessionAccessGrant = {
  sessionId: 'session-owner',
  clientId: 'client-owner',
  accessToken: 'owner-access-token',
  inviteToken: 'owner-invite-token',
};

const guestGrant: SessionAccessGrant = {
  sessionId: 'session-guest',
  clientId: 'client-guest',
  accessToken: 'guest-access-token',
};

describe('session grant cookies', () => {
  it('round-trips owner invite capabilities without inventing one for guests', () => {
    const cookie = serializeSessionGrantsCookie([ownerGrant, guestGrant]);
    const grants = readSessionGrantsFromCookieHeader(cookie);

    assert.deepEqual(grants, [ownerGrant, guestGrant]);
    assert.equal(grants[1]?.inviteToken, undefined);
  });

  it('rejects grants whose optional invite capability is malformed', () => {
    const malformed = Buffer.from(JSON.stringify([
      {
        ...ownerGrant,
        inviteToken: 42,
      },
    ]), 'utf8').toString('base64url');

    assert.deepEqual(readSessionGrantsFromCookieValue(malformed), []);
  });

  it('replaces a session grant without changing unrelated grants', () => {
    const replacement = {
      ...ownerGrant,
      accessToken: 'rotated-owner-access-token',
    };

    assert.deepEqual(
      upsertSessionGrant([ownerGrant, guestGrant], replacement),
      [guestGrant, replacement],
    );
  });

  // Audit R12: 17 owner grants of real token lengths exceeded 4 KB, and the
  // browser then dropped the whole cookie, new grant included.
  function realGrant(role: 'owner' | 'guest'): SessionAccessGrant {
    return {
      sessionId: createSessionId(),
      clientId: createClientId(),
      accessToken: createAccessToken(),
      ...(role === 'owner' ? { inviteToken: createInviteToken() } : {}),
    };
  }

  it('stays under the browser cookie limit and always keeps the newest grant', () => {
    let grants: SessionAccessGrant[] = [];
    let newest!: SessionAccessGrant;
    for (let index = 0; index < 40; index += 1) {
      newest = realGrant('owner');
      grants = upsertSessionGrant(grants, newest);
    }
    const header = serializeSessionGrantsCookie(grants);
    assert.ok(header.length <= 4_096, `Set-Cookie is ${header.length} bytes`);
    assert.ok(header.split(';')[0].length - 'bbpc-session-grants='.length <= MAX_GRANTS_COOKIE_VALUE_LENGTH);
    assert.deepEqual(grants.at(-1), newest);
    assert.ok(grants.length >= 12, `kept only ${grants.length} grants`);
  });

  it('evicts guest grants before owner grants', () => {
    const owners = Array.from({ length: 10 }, () => realGrant('owner'));
    const guests = Array.from({ length: 10 }, () => realGrant('guest'));
    let grants: SessionAccessGrant[] = [];
    for (const grant of [...owners.slice(0, 5), ...guests, ...owners.slice(5)]) {
      grants = upsertSessionGrant(grants, grant);
    }
    for (const owner of owners) {
      assert.ok(grants.includes(owner), 'an owner grant was evicted while guest grants remained');
    }
    assert.ok(grants.length < 20);
  });
});
