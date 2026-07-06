export function shouldCreateInitialOffer(localClientId: string, remoteClientId: string): boolean {
  return localClientId.localeCompare(remoteClientId) < 0;
}

export function createRtcId(prefix: string): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}:${Date.now()}:${randomPart}`;
}
