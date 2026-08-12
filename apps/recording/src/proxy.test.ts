import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const proxy = readFileSync(new URL('./proxy.ts', import.meta.url), 'utf8');

describe('Clerk proxy', () => {
  test('restricts token origins to the recording app deployment', () => {
    expect(proxy).toMatch(/const authorizedParties/u);
    expect(proxy).toMatch(/https:\/\/record\.badboyspodcast\.com/u);
    expect(proxy).toMatch(/process\.env\.VERCEL_URL/u);
    expect(proxy).toMatch(/http:\/\/localhost:3000/u);
    expect(proxy).toMatch(/clerkMiddleware\(\{ authorizedParties \}\)/u);
  });
});
