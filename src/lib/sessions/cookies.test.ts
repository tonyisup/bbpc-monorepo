import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  readSessionGrantsFromCookieHeader,
  readSessionGrantsFromCookieValue,
  serializeSessionGrantsCookie,
  upsertSessionGrant,
} from './cookies';
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
});
