import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireParticipant } from './access';

export const saveUpload = mutation({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    episode: v.string(),
    hostName: v.string(),
    trackType: v.union(v.literal('mic'), v.literal('sounders')),
    startedAt: v.number(),
    blobName: v.string(),
    url: v.string(),
    size: v.number(),
    contentType: v.string(),
    uploadedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicSessionId, args.clientId, args.accessToken);
    const upload = {
      publicSessionId: args.publicSessionId,
      episode: args.episode,
      hostName: args.hostName,
      trackType: args.trackType,
      startedAt: args.startedAt,
      blobName: args.blobName,
      url: args.url,
      size: args.size,
      contentType: args.contentType,
      uploadedAt: args.uploadedAt,
    };
    const existing = await ctx.db
      .query('recordingUploads')
      .withIndex('by_blob_name', q => q.eq('blobName', args.blobName))
      .unique();

    if (existing) {
      if (existing.publicSessionId !== args.publicSessionId) {
        throw new Error('Recording upload belongs to a different session');
      }
      await ctx.db.patch(existing._id, upload);
      return existing._id;
    }

    return await ctx.db.insert('recordingUploads', upload);
  },
});

export const listBySession = query({
  args: {
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireParticipant(ctx, args.publicSessionId, args.clientId, args.accessToken);
    const uploads = await ctx.db
      .query('recordingUploads')
      .withIndex('by_public_session_id', q => q.eq('publicSessionId', args.publicSessionId))
      .collect();

    return uploads
      .sort((a, b) => a.startedAt - b.startedAt || a.hostName.localeCompare(b.hostName))
      .map(upload => ({
        id: upload._id,
        publicSessionId: upload.publicSessionId,
        episode: upload.episode,
        hostName: upload.hostName,
        trackType: upload.trackType,
        startedAt: upload.startedAt,
        blobName: upload.blobName,
        url: upload.url,
        size: upload.size,
        contentType: upload.contentType,
        uploadedAt: upload.uploadedAt,
      }));
  },
});
