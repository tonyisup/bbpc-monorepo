import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

// Simulates a device clock `skewMs` behind the server, with a round trip per
// request; the server reads its clock halfway through each request.
function fakeNetwork(skewMs: number, roundTrips: number[]) {
  let wall = 1_000_000;
  let mono = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => wall);
  vi.stubGlobal('performance', { now: () => mono });
  const queue = [...roundTrips];
  vi.stubGlobal('fetch', vi.fn(async () => {
    const trip = queue.shift() ?? 50;
    const serverNow = wall + trip / 2 + skewMs;
    wall += trip;
    mono += trip;
    return new Response(JSON.stringify({ now: serverNow }));
  }));
}

describe('server clock', () => {
  it('estimates the device offset from the fastest round trip', async () => {
    // A slow sample whose server stamp is not at the midpoint would skew the estimate.
    fakeNetwork(-3_000, [400, 20, 90, 60, 250]);
    const clock = await import('./clock');
    const sync = await clock.syncServerClock();
    expect(sync?.roundTripMs).toBe(20);
    expect(sync?.offsetMs).toBeCloseTo(-3_000, 5);
    expect(clock.serverNow() - Date.now()).toBe(-3_000);
  });

  it('keeps the last offset when the server cannot be reached', async () => {
    fakeNetwork(2_000, [30]);
    const clock = await import('./clock');
    await clock.syncServerClock(1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(clock.syncServerClock(2)).resolves.toBeNull();
    expect(clock.serverNow() - Date.now()).toBe(2_000);
  });
});
