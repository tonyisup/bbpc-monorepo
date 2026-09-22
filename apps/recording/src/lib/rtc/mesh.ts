import { createPortableId } from '@/lib/portable-ids';

export function shouldCreateInitialOffer(localClientId: string, remoteClientId: string): boolean {
  return localClientId.localeCompare(remoteClientId) < 0;
}

export function createRtcId(...parts: string[]): string {
  return createPortableId('rtc', ...parts);
}

/**
 * Relay-only ICE for testing TURN: add `?rtc=relay` to the session URL on a
 * device and its calls connect only through the TURN server.
 */
export function iceTransportPolicyFor(search: string): RTCIceTransportPolicy {
  return new URLSearchParams(search).get('rtc') === 'relay' ? 'relay' : 'all';
}
