import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireParticipant } from './access';

const favoriteInput = v.object({
  id: v.string(),
  name: v.string(),
  category: v.string(),
  duration: v.number(),
  url: v.string(),
});

export const list = query({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicSessionId, args.clientId, args.accessToken);
    const favorites = await ctx.db
      .query('sessionFavorites')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicSessionId))
      .collect();

    return favorites
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(favorite => ({
        id: favorite.sounderId,
        name: favorite.name,
        category: favorite.category,
        duration: favorite.duration,
        url: favorite.url,
      }));
  },
});

export const replaceAll = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    favorites: v.array(favoriteInput),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicSessionId, args.clientId, args.accessToken);
    const existing = await ctx.db
      .query('sessionFavorites')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicSessionId))
      .collect();

    for (const favorite of existing) {
      await ctx.db.delete(favorite._id);
    }

    for (const [index, favorite] of args.favorites.entries()) {
      await ctx.db.insert('sessionFavorites', {
        publicSessionId: args.publicSessionId,
        sounderId: favorite.id,
        name: favorite.name,
        category: favorite.category,
        duration: favorite.duration,
        url: favorite.url,
        sortOrder: index,
        updatedAt: args.updatedAt,
      });
    }

    return { count: args.favorites.length };
  },
});
