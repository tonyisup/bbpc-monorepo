import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

loadEnv({ path: '.env.local' });
loadEnv();

const configPath = path.join(process.cwd(), 'segment-templates.json');
const raw = await fs.readFile(configPath, 'utf8');
const config = JSON.parse(raw);

if (!Array.isArray(config.segmentTemplates)) {
  throw new Error('segment-templates.json must contain a segmentTemplates array');
}

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error('NEXT_PUBLIC_CONVEX_URL is not configured');
}
const adminSecret = process.env.SESSION_ADMIN_SECRET;
if (!adminSecret) {
  throw new Error('SESSION_ADMIN_SECRET is required');
}

const client = new ConvexHttpClient(convexUrl);
const result = await client.mutation(api.segmentTemplates.upsertMany, {
  adminSecret,
  templates: config.segmentTemplates.map((template, index) => ({
    ...template,
    sortOrder: template.sortOrder ?? index,
  })),
  updatedAt: Date.now(),
});

console.log(`Seeded ${result.count} segment templates`);
