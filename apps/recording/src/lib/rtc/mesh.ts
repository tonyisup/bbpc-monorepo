import { createPortableId } from '@/lib/portable-ids';

export function shouldCreateInitialOffer(localClientId: string, remoteClientId: string): boolean {
  return localClientId.localeCompare(remoteClientId) < 0;
}

export function createRtcId(...parts: string[]): string {
  return createPortableId('rtc', ...parts);
}
