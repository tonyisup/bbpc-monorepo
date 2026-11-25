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

/** A sync this recent is trusted for a new take. */
export const FRESH_CLOCK_SYNC_MS = 10 * 60 * 1000;
let inFlight: Promise<ClockSync | null> | null = null;

/**
 * A recent sync, syncing first if there is none. Until a sync succeeds the
 * offset is 0, so a take stamped then would sit on the merged timeline by its
 * device clock's error, and a later sync would shift the take's markers away
 * from its audio. Starting or joining a take waits for this instead.
 */
export async function ensureServerClock(): Promise<ClockSync | null> {
  if (lastSync && Date.now() - lastSync.syncedAt < FRESH_CLOCK_SYNC_MS) return lastSync;
  return syncServerClock();
}

/**
 * NTP-style estimate: the server read its clock about halfway through the
 * request, and the sample with the shortest round trip is the most accurate.
 * On failure the previous offset stays in use.
 */
export function syncServerClock(samples = 5): Promise<ClockSync | null> {
  // Concurrent callers share one sync instead of racing to set the offset.
  inFlight ??= runClockSync(samples).finally(() => { inFlight = null; });
  return inFlight;
}

async function runClockSync(samples: number): Promise<ClockSync | null> {
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
