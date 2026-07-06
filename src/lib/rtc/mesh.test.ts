import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert/strict';
import { shouldCreateInitialOffer } from './mesh';

describe('mesh offer ownership', () => {
  it('uses the lexicographically smaller client id as offer owner', () => {
    assert.equal(shouldCreateInitialOffer('a-client', 'b-client'), true);
    assert.equal(shouldCreateInitialOffer('b-client', 'a-client'), false);
  });

  it('does not create an offer for equal ids', () => {
    assert.equal(shouldCreateInitialOffer('same', 'same'), false);
  });

  it('is deterministic for generated session client ids', () => {
    assert.equal(shouldCreateInitialOffer('client_001', 'client_010'), true);
  });
});
