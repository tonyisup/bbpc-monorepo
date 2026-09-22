import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * The server's clock, which every participant's timeline is aligned to.
 * Unauthenticated: it reveals only the current time.
 */
export function GET() {
  return NextResponse.json({ now: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
