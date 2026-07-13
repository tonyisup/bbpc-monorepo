import { v } from 'convex/values';

const role = v.union(v.literal('owner'), v.literal('participant'));
const segmentType = v.union(
  v.literal('intro'),
  v.literal('segment'),
  v.literal('ad'),
  v.literal('outro'),
  v.literal('news'),
  v.literal('interview'),
);
const editCueType = v.union(
  v.literal('doxx-bleep'),
  v.literal('network-drop'),
  v.literal('dmca-music'),
  v.literal('spoiler'),
  v.literal('other'),
);
const disconnectReason = v.union(
  v.literal('ice-disconnected'),
  v.literal('ice-failed'),
  v.literal('heartbeat-timeout'),
  v.literal('page-hidden-timeout'),
);
const sounder = v.object({
  id: v.string(),
  name: v.string(),
  category: v.string(),
  duration: v.number(),
  url: v.string(),
});
const note = v.object({
  id: v.string(),
  timestamp_ms: v.number(),
  text: v.string(),
  author: v.string(),
});
const segment = v.object({
  id: v.string(),
  start_ms: v.number(),
  end_ms: v.union(v.number(), v.null()),
  type: segmentType,
  label: v.string(),
});
const editCue = v.object({
  id: v.string(),
  start_ms: v.number(),
  end_ms: v.union(v.number(), v.null()),
  type: editCueType,
  reason: v.optional(v.string()),
  author: v.optional(v.string()),
});

export const sessionEventPayload = v.union(
  v.object({
    kind: v.literal('sounder'),
    sounder,
    played_at_ms: v.number(),
    played_by: v.string(),
    from: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('note'), note, from: v.optional(v.string()) }),
  v.object({ kind: v.literal('note-delete'), id: v.string(), from: v.optional(v.string()) }),
  v.object({ kind: v.literal('segment-start'), segment, from: v.optional(v.string()) }),
  v.object({
    kind: v.literal('segment-end'),
    id: v.string(),
    end_ms: v.number(),
    from: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('segment-delete'), id: v.string(), from: v.optional(v.string()) }),
  v.object({ kind: v.literal('edit-cue'), cue: editCue, from: v.optional(v.string()) }),
  v.object({
    kind: v.literal('edit-cue-update'),
    id: v.string(),
    end_ms: v.number(),
    from: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('edit-cue-delete'), id: v.string(), from: v.optional(v.string()) }),
  v.object({
    kind: v.literal('episode-update'),
    episode: v.string(),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('recording-started'),
    startedAt: v.number(),
    startedByRole: v.optional(v.literal('owner')),
    participant: v.optional(v.object({
      clientId: v.string(),
      name: v.string(),
      role: v.literal('owner'),
      joinedAt: v.number(),
    })),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('recording-stopped'),
    startedAt: v.number(),
    durationMs: v.number(),
    stoppedByRole: v.optional(v.literal('owner')),
    participant: v.optional(v.object({
      clientId: v.string(),
      leftAt: v.number(),
      reason: v.literal('host-stopped'),
    })),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('recording-joined'),
    participant: v.object({
      clientId: v.string(),
      name: v.string(),
      role,
      joinedAt: v.number(),
      recordingStartedAt: v.number(),
    }),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('recording-left'),
    participant: v.object({
      clientId: v.string(),
      leftAt: v.number(),
      recordingStartedAt: v.number(),
      reason: v.optional(v.union(v.literal('left'), v.literal('host-stopped'))),
    }),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('audio-joined'),
    participant: v.object({
      clientId: v.string(),
      name: v.string(),
      role,
      joinedAudioAt: v.number(),
      recordingStartedAt: v.union(v.number(), v.null()),
    }),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('audio-left'),
    participant: v.object({
      clientId: v.string(),
      leftAudioAt: v.number(),
      recordingStartedAt: v.union(v.number(), v.null()),
    }),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('audio-disconnect-started'),
    disconnect: v.object({
      disconnectId: v.string(),
      clientId: v.string(),
      startedAt: v.number(),
      recordingStartedAt: v.union(v.number(), v.null()),
      reason: disconnectReason,
    }),
    from: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('audio-disconnect-ended'),
    disconnect: v.object({
      disconnectId: v.string(),
      clientId: v.string(),
      endedAt: v.number(),
      recordingStartedAt: v.union(v.number(), v.null()),
    }),
    from: v.optional(v.string()),
  }),
);
