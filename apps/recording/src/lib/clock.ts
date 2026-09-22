/**
 * Participants' device clocks can be seconds apart, and every timeline
 * timestamp (take starts, joins, leaves, disconnects, sounders) is compared
 * across devices. Each browser estimates its offset from the server clock and
 * stamps the timeline with serverNow() instead of Date.now().
 */

let offsetMs = 0;
let lastSync: ClockSync | null = null;

export interface ClockSync {
  offsetMs: number;
  roundTripMs: number;
  syncedAt: number;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function lastClockSync(): ClockSync | null {
  return lastSync;
}

/**
 * NTP-style estimate: the server read its clock about halfway through the
 * request, and the sample with the shortest round trip is the most accurate.
 * On failure the previous offset stays in use.
 */
export async function syncServerClock(samples = 5): Promise<ClockSync | null> {
  let best: ClockSync | null = null;
  for (let index = 0; index < samples; index += 1) {
    try {
      const sentAt = Date.now();
      const started = performance.now();
      const response = await fetch('/api/time', { cache: 'no-store' });
      const roundTripMs = performance.now() - started;
      if (!response.ok) continue;
      const { now } = await response.json() as { now?: unknown };
      if (typeof now !== 'number' || !Number.isFinite(now)) continue;
      const sample = { offsetMs: now - (sentAt + roundTripMs / 2), roundTripMs, syncedAt: sentAt };
      if (!best || sample.roundTripMs < best.roundTripMs) best = sample;
    } catch {
      // Try the next sample.
    }
  }
  if (best) {
    offsetMs = Math.round(best.offsetMs);
    lastSync = best;
  }
  return best;
}
