import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdminSecret } from './access';

const sounderInput = v.object({
  id: v.string(),
  blobName: v.string(),
  name: v.string(),
  category: v.string(),
  url: v.string(),
  duration: v.number(),
  size: v.number(),
  contentType: v.string(),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const sounders = await ctx.db.query('sounders').collect();

    return sounders
      .sort((a, b) => {
        const orderCmp = a.sortOrder - b.sortOrder;
        if (orderCmp !== 0) return orderCmp;
        const categoryCmp = a.category.localeCompare(b.category);
        if (categoryCmp !== 0) return categoryCmp;
        return a.name.localeCompare(b.name);
      })
      .map(sounder => ({
        id: sounder.sounderId,
        blobName: sounder.blobName,
        name: sounder.name,
        category: sounder.category,
        url: sounder.url,
        duration: sounder.duration,
        size: sounder.size,
        contentType: sounder.contentType,
      }));
  },
});

export const replaceAll = mutation({
  args: {
    adminSecret: v.string(),
    sounders: v.array(sounderInput),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireAdminSecret(args.adminSecret);
    const existing = await ctx.db.query('sounders').collect();

    for (const sounder of existing) {
      await ctx.db.delete(sounder._id);
    }

    for (const [index, sounder] of args.sounders.entries()) {
      await ctx.db.insert('sounders', {
        sounderId: sounder.id,
        blobName: sounder.blobName,
        name: sounder.name,
        category: sounder.category,
        url: sounder.url,
        duration: sounder.duration,
        size: sounder.size,
        contentType: sounder.contentType,
        sortOrder: index,
        updatedAt: args.updatedAt,
      });
    }

    return { count: args.sounders.length };
  },
});
