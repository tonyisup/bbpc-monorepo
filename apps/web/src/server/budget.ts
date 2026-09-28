/** How long until a spent budget refills, in words. */
export function retryWait(retryAt: number) {
  const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000));
  if (minutes < 60)
    return `${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
}

/** The Retry-After header value for a spent budget. */
export function retryAfterSeconds(retryAt: number) {
  return String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)));
}
