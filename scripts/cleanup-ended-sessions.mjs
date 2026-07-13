import 'dotenv/config';
import { config as loadDotenv } from 'dotenv';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

loadDotenv({ path: '.env.local', override: true });
loadDotenv({ path: '.env', override: false });

const args = new Map(
  process.argv.slice(2).map(arg => {
    const [key, value = ''] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }),
);

const days = Number(args.get('days') ?? '30');
const limit = Number(args.get('limit') ?? '25');

if (!Number.isFinite(days) || days < 1) {
  throw new Error('--days must be a positive number');
}

if (!Number.isFinite(limit) || limit < 1) {
  throw new Error('--limit must be a positive number');
}

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error('NEXT_PUBLIC_CONVEX_URL is required');
}
const adminSecret = process.env.SESSION_ADMIN_SECRET;
if (!adminSecret) {
  throw new Error('SESSION_ADMIN_SECRET is required');
}

const olderThan = Date.now() - days * 24 * 60 * 60 * 1000;
const client = new ConvexHttpClient(convexUrl);
const result = await client.mutation(api.sessions.cleanupEndedSessions, {
  olderThan,
  limit,
  confirmation: 'delete-ended-sessions',
  adminSecret,
});

console.log(JSON.stringify({
  olderThan: new Date(olderThan).toISOString(),
  ...result,
}, null, 2));
