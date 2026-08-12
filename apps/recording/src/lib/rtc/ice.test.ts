import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert/strict';
import { buildIceConfig, createTurnCredential, parseIceUrls } from './ice';

describe('rtc ice config', () => {
  it('parses comma separated ICE URLs', () => {
    assert.deepEqual(parseIceUrls(' stun:a , turn:b ,,turn:c '), ['stun:a', 'turn:b', 'turn:c']);
  });

  it('creates coturn REST credentials with ttl', () => {
    const result = createTurnCredential({
      clientId: 'client-1',
      staticAuthSecret: 'secret',
      ttlSeconds: 60,
      nowMs: 1_700_000_000_000,
    });

    assert.equal(result.username, '1700000060:client-1');
    assert.equal(result.expiresAt, 1_700_000_060_000);
    assert.equal(result.credential, '8B8Pb9+39ghXxMTkspYL3KnXXGM=');
  });

  it('omits TURN when no static auth secret is configured', () => {
    const config = buildIceConfig({
      clientId: 'client-1',
      turnUrls: ['turn:example.test'],
      stunUrls: ['stun:example.test'],
      ttlSeconds: 3600,
      nowMs: 1_700_000_000_000,
    });

    assert.deepEqual(config.iceServers, [{ urls: ['stun:example.test'] }]);
  });
});
