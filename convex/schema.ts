import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  sessions: defineTable({
    publicId: v.string(),
    episode: v.string(),
    status: v.union(v.literal('active'), v.literal('ended')),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index('by_public_id', ['publicId'])
    .index('by_status_created_at', ['status', 'createdAt']),

  sessionInvites: defineTable({
    token: v.string(),
    sessionId: v.id('sessions'),
    publicSessionId: v.string(),
    createdAt: v.number(),
  })
    .index('by_token', ['token'])
    .index('by_public_session_id', ['publicSessionId']),

  participants: defineTable({
    sessionId: v.id('sessions'),
    publicSessionId: v.string(),
    clientId: v.string(),
    accessToken: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('owner'), v.literal('participant')),
    joinedAt: v.number(),
  })
    .index('by_public_session_id', ['publicSessionId'])
    .index('by_access', ['publicSessionId', 'clientId', 'accessToken']),

  rtcPresence: defineTable({
    publicSessionId: v.string(),
    clientId: v.string(),
    displayName: v.string(),
    role: v.union(v.literal('owner'), v.literal('participant')),
    joinedAudioAt: v.number(),
    lastSeenAt: v.number(),
    muted: v.boolean(),
    recording: v.boolean(),
  })
    .index('by_public_session_id', ['publicSessionId'])
    .index('by_participant', ['publicSessionId', 'clientId'])
    .index('by_last_seen', ['publicSessionId', 'lastSeenAt']),

  rtcSignals: defineTable({
    publicSessionId: v.string(),
    fromClientId: v.string(),
    toClientId: v.string(),
    signalId: v.string(),
    createdAt: v.number(),
    type: v.union(
      v.literal('offer'),
      v.literal('answer'),
      v.literal('ice-candidate'),
      v.literal('leave'),
      v.literal('renegotiate'),
    ),
    payload: v.any(),
  })
    .index('by_recipient', ['publicSessionId', 'toClientId'])
    .index('by_signal_id', ['signalId'])
    .index('by_created_at', ['publicSessionId', 'createdAt']),

  sessionEvents: defineTable({
    publicSessionId: v.string(),
    eventId: v.string(),
    actorId: v.string(),
    createdAt: v.number(),
    payload: v.any(),
  })
    .index('by_public_session_id', ['publicSessionId'])
    .index('by_event_id', ['eventId']),

  segmentTemplates: defineTable({
    templateId: v.string(),
    label: v.string(),
    type: v.union(
      v.literal('intro'),
      v.literal('segment'),
      v.literal('ad'),
      v.literal('outro'),
      v.literal('news'),
      v.literal('interview'),
    ),
    introSounder: v.optional(v.string()),
    outroSounder: v.optional(v.string()),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index('by_template_id', ['templateId'])
    .index('by_sort_order', ['sortOrder']),

  sessionManifests: defineTable({
    publicSessionId: v.string(),
    episode: v.string(),
    date: v.string(),
    hosts: v.array(v.string()),
    manifestVersion: v.string(),
    manifest: v.any(),
    updatedAt: v.number(),
  }).index('by_public_session_id', ['publicSessionId']),

  sessionFavorites: defineTable({
    publicSessionId: v.string(),
    sounderId: v.string(),
    name: v.string(),
    category: v.string(),
    duration: v.number(),
    url: v.string(),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index('by_public_session_id', ['publicSessionId'])
    .index('by_sounder', ['publicSessionId', 'sounderId']),

  sounders: defineTable({
    sounderId: v.string(),
    blobName: v.string(),
    name: v.string(),
    category: v.string(),
    url: v.string(),
    duration: v.number(),
    size: v.number(),
    contentType: v.string(),
    sortOrder: v.number(),
    updatedAt: v.number(),
  })
    .index('by_sounder_id', ['sounderId'])
    .index('by_category', ['category', 'name']),

  recordingUploads: defineTable({
    publicSessionId: v.optional(v.string()),
    episode: v.string(),
    hostName: v.string(),
    trackType: v.union(v.literal('mic'), v.literal('sounders')),
    startedAt: v.number(),
    blobName: v.string(),
    url: v.string(),
    size: v.number(),
    contentType: v.string(),
    uploadedAt: v.number(),
  })
    .index('by_public_session_id', ['publicSessionId'])
    .index('by_episode', ['episode'])
    .index('by_blob_name', ['blobName']),
});
