import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('server time', () => {
  it('returns the current server time without caching', async () => {
    const before = Date.now();
    const response = GET();
    const { now } = await response.json();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
