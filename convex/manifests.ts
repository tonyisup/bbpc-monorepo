import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireParticipant } from './access';

export const save = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    episode: v.string(),
    date: v.string(),
    hosts: v.array(v.string()),
    manifestVersion: v.string(),
    manifest: v.any(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicSessionId, args.clientId, args.accessToken);
    const existing = await ctx.db
      .query('sessionManifests')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicSessionId))
      .unique();

    const doc = {
      publicSessionId: args.publicSessionId,
      episode: args.episode,
      date: args.date,
      hosts: args.hosts,
      manifestVersion: args.manifestVersion,
      manifest: args.manifest,
      updatedAt: args.updatedAt,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }

    return await ctx.db.insert('sessionManifests', doc);
  },
});

export const getBySession = query({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicSessionId, args.clientId, args.accessToken);
    const saved = await ctx.db
      .query('sessionManifests')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicSessionId))
      .unique();

    if (!saved) return null;

    return {
      publicSessionId: saved.publicSessionId,
      episode: saved.episode,
      date: saved.date,
      hosts: saved.hosts,
      manifestVersion: saved.manifestVersion,
      manifest: saved.manifest,
      updatedAt: saved.updatedAt,
    };
  },
});
