/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { digestRecordingCapability } from "./recording/access.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "recording-session-test";
const HOST_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-host",
  issuer: "https://issuer.example.test",
  subject: "recording-host",
};
const MEMBER_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-member",
  issuer: "https://issuer.example.test",
  subject: "recording-member",
};
const ADMIN_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-admin",
  issuer: "https://issuer.example.test",
  subject: "recording-admin",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedUser(
  t: TestBackend,
  input: {
    identity: typeof HOST_IDENTITY;
    name: string;
    email: string;
    role?: "host" | "admin";
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: input.email,
      normalizedEmail: input.email,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...input.identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (input.role !== undefined) {
      const roleId = await ctx.db.insert("roles", {
        name:
          input.role === "admin"
            ? "Administrator"
            : "Host",
        normalizedName:
          input.role === "admin"
            ? "administrator"
            : "host",
        description: `${input.role} role`,
        admin: input.role === "admin",
        permissions:
          input.role === "admin" ? ["admin"] : ["host"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: 1,
      });
    }
    return userId;
  });
}

async function initializeAtS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "recording-session-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "recording-session-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "recording-session-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "recording-session-test",
    approvedBackupId: "recording-test-backup",
    approvedBackupChecksum: "sha256:recording-test",
  });
}

function ownerInput(suffix: string, createdAt = 1_000) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    publicId: `sess_recording_${suffix}`,
    inviteToken: `inv_${suffix}_abcdefghijklmnopqrstuvwxyz`,
    episode: "EP-TEST",
    createdAt,
    participant: {
      clientId: `client_owner_${suffix}`,
      accessToken: `access_${suffix}_abcdefghijklmnopqrstuvwxyz`,
      displayName: " Recording Host ",
      joinedAt: createdAt,
    },
  };
}

describe("shared recording session boundary", () => {
  test("requires S3 plus a linked host or administrator", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedUser(t, {
      identity: MEMBER_IDENTITY,
      name: "Member",
      email: "member@example.test",
    });
    await initializeAtS1(t);

    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.sessions.createSession,
        ownerInput("write_gate"),
      ),
      "WRITE_DISABLED",
    );
    await advanceToS3(t);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.recording.sessions.createSession,
        ownerInput("member"),
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.mutation(
        api.recording.sessions.createSession,
        ownerInput("anonymous"),
      ),
      "AUTHENTICATION_REQUIRED",
    );
  });

  test("stores only capability digests and never returns tokens", async () => {
    const t = createTestBackend();
    const hostId = await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const input = ownerInput("digest");
    const session = await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, input);

    expect(session).toMatchObject({
      id: input.publicId,
      episodeId: null,
      episode: "EP-TEST",
      status: "active",
      participants: [
        {
          clientId: input.participant.clientId,
          displayName: "Recording Host",
          role: "owner",
        },
      ],
    });
    expect(JSON.stringify(session)).not.toContain(
      input.inviteToken,
    );
    expect(JSON.stringify(session)).not.toContain(
      input.participant.accessToken,
    );

    const persisted = await t.run(async (ctx) => ({
      session: await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", input.publicId),
        )
        .unique(),
      invite: await ctx.db
        .query("recordingSessionInvites")
        .withIndex("by_publicSessionId", (query) =>
          query.eq("publicSessionId", input.publicId),
        )
        .unique(),
      participant: await ctx.db
        .query("recordingParticipants")
        .withIndex("by_publicSessionId", (query) =>
          query.eq("publicSessionId", input.publicId),
        )
        .unique(),
    }));
    expect(persisted.session?.ownerUserId).toBe(hostId);
    expect(persisted.invite?.tokenDigest).toBe(
      digestRecordingCapability(input.inviteToken),
    );
    expect(persisted.participant).toMatchObject({
      userId: hostId,
      accessTokenDigest: digestRecordingCapability(
        input.participant.accessToken,
      ),
    });
    expect(JSON.stringify(persisted)).not.toContain(
      input.inviteToken,
    );
    expect(JSON.stringify(persisted)).not.toContain(
      input.participant.accessToken,
    );
  });

  test("joins idempotently and isolates owner-only controls", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const input = ownerInput("guest");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, input);
    const guest = {
      clientApiVersion: BBPC_API_VERSION,
      inviteToken: input.inviteToken,
      participant: {
        clientId: "client_guest_abcdefghijklmnopqrstuvwxyz",
        accessToken:
          "access_guest_abcdefghijklmnopqrstuvwxyz",
        displayName: " Guest ",
        joinedAt: 1_001,
      },
    };
    const joined = await t.mutation(
      api.recording.sessions.joinSessionByInviteToken,
      guest,
    );
    const replayed = await t.mutation(
      api.recording.sessions.joinSessionByInviteToken,
      guest,
    );
    expect(joined?.participants).toHaveLength(2);
    expect(replayed?.participants).toHaveLength(2);
    expect(JSON.stringify(joined)).not.toContain(
      guest.participant.accessToken,
    );

    const guestGrant = {
      clientApiVersion: BBPC_API_VERSION,
      publicId: input.publicId,
      clientId: guest.participant.clientId,
      accessToken: guest.participant.accessToken,
    };
    await expectDomainError(
      t.mutation(
        api.recording.sessions.updateSessionEpisode,
        {
          ...guestGrant,
          episode: "HIJACKED",
        },
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.mutation(api.recording.sessions.endSession, guestGrant),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.query(api.recording.sessions.getSession, {
        publicId: input.publicId,
        clientId: guest.participant.clientId,
        accessToken:
          "access_wrong_abcdefghijklmnopqrstuvwxyz",
      }),
      "FORBIDDEN",
    );
  });

  test("links a canonical episode and rejects event spoofing", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    const episodeId = await t.run(async (ctx) =>
      ctx.db.insert("episodes", {
        number: 1,
        title: "Recording Episode",
      }),
    );
    await initializeAtS1(t);
    await advanceToS3(t);
    const input = {
      ...ownerInput("episode"),
      episodeId,
    };
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, input);
    const ownerGrant = {
      clientApiVersion: BBPC_API_VERSION,
      publicId: input.publicId,
      clientId: input.participant.clientId,
      accessToken: input.participant.accessToken,
    };
    await expectDomainError(
      t.mutation(api.recording.sessions.appendSessionEvent, {
        ...ownerGrant,
        eventId: "event_spoofed_disconnect",
        createdAt: 1_001,
        payload: {
          kind: "audio-disconnect-started",
          disconnect: {
            disconnectId: "disconnect_01",
            clientId: "client_someone_else",
            startedAt: 1_001,
            recordingStartedAt: null,
            reason: "ice-disconnected",
          },
        },
      }),
      "FORBIDDEN",
    );
    const eventId = await t.mutation(
      api.recording.sessions.appendSessionEvent,
      {
        ...ownerGrant,
        eventId: "event_owner_started",
        createdAt: 1_002,
        payload: {
          kind: "recording-started",
          startedAt: 1_002,
          startedByRole: "owner",
        },
      },
    );
    const replay = await t.mutation(
      api.recording.sessions.appendSessionEvent,
      {
        ...ownerGrant,
        eventId: "event_owner_started",
        createdAt: 1_003,
        payload: {
          kind: "recording-started",
          startedAt: 1_003,
          startedByRole: "owner",
        },
      },
    );
    expect(replay).toBe(eventId);
    const lifecycle = await t.query(
      api.recording.sessions.getSessionLifecycle,
      {
        publicId: input.publicId,
        clientId: input.participant.clientId,
        accessToken: input.participant.accessToken,
      },
    );
    expect(lifecycle.episodeId).toBe(episodeId);
  });

  test("retention cleanup uses endedAt and requires an administrator", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      role: "admin",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const recent = ownerInput("recent", 1);
    const expired = ownerInput("expired", 1);
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, recent);
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, expired);
    await t.run(async (ctx) => {
      const recentSession = await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", recent.publicId),
        )
        .unique();
      const expiredSession = await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", expired.publicId),
        )
        .unique();
      if (
        recentSession === null ||
        expiredSession === null
      ) {
        throw new Error("Expected recording sessions.");
      }
      await ctx.db.patch("recordingSessions", recentSession._id, {
        status: "ended",
        endedAt: 900,
      });
      await ctx.db.patch(
        "recordingSessions",
        expiredSession._id,
        {
          status: "ended",
          endedAt: 100,
        },
      );
    });
    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.sessions.cleanupEndedSessions,
        {
          clientApiVersion: BBPC_API_VERSION,
          olderThan: 500,
          confirmation: "delete-ended-sessions",
        },
      ),
      "FORBIDDEN",
    );
    const deleted = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(
        api.recording.sessions.cleanupEndedSessions,
        {
          clientApiVersion: BBPC_API_VERSION,
          olderThan: 500,
          confirmation: "delete-ended-sessions",
        },
      );
    expect(deleted).toMatchObject({
      sessions: 1,
      invites: 1,
      participants: 1,
    });
    const remaining = await t.run(async (ctx) =>
      ctx.db.query("recordingSessions").take(10),
    );
    expect(remaining.map((session) => session.publicId)).toEqual([
      recent.publicId,
    ]);
  });

  test("rejects duplicate session capabilities and unavailable episodes", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await initializeAtS1(t);
    await advanceToS3(t);

    const missingEpisodeId = await t.run(async (ctx) => {
      const episodeId = await ctx.db.insert("episodes", {
        number: 404,
        title: "Removed recording episode",
      });
      await ctx.db.delete("episodes", episodeId);
      return episodeId;
    });
    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.sessions.createSession,
        {
          ...ownerInput("missing_episode"),
          episodeId: missingEpisodeId,
        },
      ),
      "NOT_FOUND",
    );

    const first = ownerInput("duplicate_capability");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, first);
    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.sessions.createSession,
        {
          ...ownerInput("duplicate_public_id"),
          publicId: first.publicId,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.sessions.createSession,
        {
          ...ownerInput("duplicate_invite"),
          inviteToken: first.inviteToken,
        },
      ),
      "CONFLICT",
    );

    await expect(
      t.mutation(api.recording.sessions.joinSessionByInviteToken, {
        clientApiVersion: BBPC_API_VERSION,
        inviteToken: "inv_missing_abcdefghijklmnopqrstuvwxyz",
        participant: {
          clientId: "client_missing_invite",
          accessToken:
            "access_missing_invite_abcdefghijklmnopqrstuvwxyz",
          displayName: "Missing",
          joinedAt: 1_001,
        },
      }),
    ).resolves.toBeNull();

    await expectDomainError(
      t.mutation(api.recording.sessions.joinSessionByInviteToken, {
        clientApiVersion: BBPC_API_VERSION,
        inviteToken: first.inviteToken,
        participant: {
          ...first.participant,
          displayName: "Different Owner",
        },
      }),
      "CONFLICT",
    );
  });

  test("fails closed on ambiguous and corrupt session relationships", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const first = ownerInput("corrupt_one");
    const second = ownerInput("corrupt_two");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, first);
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, second);

    await t.run(async (ctx) => {
      const invite = await ctx.db
        .query("recordingSessionInvites")
        .withIndex("by_publicSessionId", (query) =>
          query.eq("publicSessionId", first.publicId),
        )
        .unique();
      const firstSession = await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", first.publicId),
        )
        .unique();
      if (invite === null || firstSession === null) {
        throw new Error("Expected seeded recording session.");
      }
      await ctx.db.insert("recordingSessionInvites", {
        tokenDigest: invite.tokenDigest,
        sessionId: firstSession._id,
        publicSessionId: first.publicId,
        createdAt: invite.createdAt,
      });
    });
    await expectDomainError(
      t.mutation(api.recording.sessions.joinSessionByInviteToken, {
        clientApiVersion: BBPC_API_VERSION,
        inviteToken: first.inviteToken,
        participant: {
          clientId: "client_ambiguous_invite",
          accessToken:
            "access_ambiguous_invite_abcdefghijklmnopqrstuvwxyz",
          displayName: "Ambiguous",
          joinedAt: 1_001,
        },
      }),
      "CONFLICT",
    );

    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query("recordingParticipants")
        .withIndex(
          "by_publicSessionId_and_clientId",
          (query) =>
            query
              .eq("publicSessionId", first.publicId)
              .eq("clientId", first.participant.clientId),
        )
        .unique();
      const secondSession = await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", second.publicId),
        )
        .unique();
      if (participant === null || secondSession === null) {
        throw new Error("Expected seeded recording relationships.");
      }
      await ctx.db.patch(
        "recordingParticipants",
        participant._id,
        { sessionId: secondSession._id },
      );
    });
    await expectDomainError(
      t.query(api.recording.sessions.getSession, {
        publicId: first.publicId,
        clientId: first.participant.clientId,
        accessToken: first.participant.accessToken,
      }),
      "CONFLICT",
    );
  });

  test("bounds participants and preserves ended-session idempotency", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const input = ownerInput("participant_limit");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, input);
    const ownerGrant = {
      clientApiVersion: BBPC_API_VERSION,
      publicId: input.publicId,
      clientId: input.participant.clientId,
      accessToken: input.participant.accessToken,
    };

    const ended = await t.mutation(
      api.recording.sessions.endSession,
      ownerGrant,
    );
    const replayed = await t.mutation(
      api.recording.sessions.endSession,
      ownerGrant,
    );
    expect(ended.status).toBe("ended");
    expect(replayed).toEqual(ended);
    await expectDomainError(
      t.mutation(api.recording.sessions.updateSessionEpisode, {
        ...ownerGrant,
        episode: "EP-LATE",
      }),
      "CONFLICT",
    );
    await expect(
      t.mutation(api.recording.sessions.joinSessionByInviteToken, {
        clientApiVersion: BBPC_API_VERSION,
        inviteToken: input.inviteToken,
        participant: {
          clientId: "client_too_late",
          accessToken:
            "access_too_late_abcdefghijklmnopqrstuvwxyz",
          displayName: "Too Late",
          joinedAt: 2_000,
        },
      }),
    ).resolves.toBeNull();

    const limited = ownerInput("participant_overflow");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, limited);
    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", limited.publicId),
        )
        .unique();
      if (session === null) {
        throw new Error("Expected participant-limit session.");
      }
      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("recordingParticipants", {
          sessionId: session._id,
          publicSessionId: session.publicId,
          clientId: `client_overflow_${String(index)}`,
          accessTokenDigest: digestRecordingCapability(
            `access_overflow_${String(index)}_abcdefghijklmnopqrstuvwxyz`,
          ),
          displayName: `Overflow ${String(index)}`,
          role: "participant",
          joinedAt: 2_000 + index,
        });
      }
    });
    await expectDomainError(
      t.query(api.recording.sessions.getSession, {
        publicId: limited.publicId,
        clientId: limited.participant.clientId,
        accessToken: limited.participant.accessToken,
      }),
      "CONFLICT",
    );
  });

  test("validates every participant-scoped event branch", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const first = ownerInput("event_first");
    const second = ownerInput("event_second");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, first);
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, second);
    const guest = {
      clientApiVersion: BBPC_API_VERSION,
      inviteToken: first.inviteToken,
      participant: {
        clientId: "client_event_guest",
        accessToken:
          "access_event_guest_abcdefghijklmnopqrstuvwxyz",
        displayName: "Event Guest",
        joinedAt: 1_001,
      },
    };
    await t.mutation(
      api.recording.sessions.joinSessionByInviteToken,
      guest,
    );
    const ownerGrant = {
      clientApiVersion: BBPC_API_VERSION,
      publicId: first.publicId,
      clientId: first.participant.clientId,
      accessToken: first.participant.accessToken,
    };
    const guestGrant = {
      clientApiVersion: BBPC_API_VERSION,
      publicId: first.publicId,
      clientId: guest.participant.clientId,
      accessToken: guest.participant.accessToken,
    };

    await expectDomainError(
      t.mutation(api.recording.sessions.appendSessionEvent, {
        ...guestGrant,
        eventId: "event_guest_owner_only",
        createdAt: 2_000,
        payload: {
          kind: "recording-started",
          startedAt: 2_000,
        },
      }),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.mutation(api.recording.sessions.appendSessionEvent, {
        ...guestGrant,
        eventId: "event_guest_wrong_role",
        createdAt: 2_001,
        payload: {
          kind: "recording-joined",
          participant: {
            clientId: guest.participant.clientId,
            name: guest.participant.displayName,
            role: "owner",
            joinedAt: 2_001,
            recordingStartedAt: 2_000,
          },
        },
      }),
      "FORBIDDEN",
    );

    const spoofedPayloads = [
      {
        kind: "recording-started" as const,
        startedAt: 2_002,
        participant: {
          clientId: "client_spoofed",
          name: "Spoofed",
          role: "owner" as const,
          joinedAt: 2_002,
        },
      },
      {
        kind: "recording-stopped" as const,
        startedAt: 2_000,
        durationMs: 2,
        participant: {
          clientId: "client_spoofed",
          leftAt: 2_002,
          reason: "host-stopped" as const,
        },
      },
      {
        kind: "recording-left" as const,
        participant: {
          clientId: "client_spoofed",
          leftAt: 2_002,
          recordingStartedAt: 2_000,
        },
      },
      {
        kind: "audio-joined" as const,
        participant: {
          clientId: "client_spoofed",
          name: "Spoofed",
          role: "participant" as const,
          joinedAudioAt: 2_002,
          recordingStartedAt: null,
        },
      },
      {
        kind: "audio-left" as const,
        participant: {
          clientId: "client_spoofed",
          leftAudioAt: 2_002,
          recordingStartedAt: null,
        },
      },
      {
        kind: "audio-disconnect-started" as const,
        disconnect: {
          disconnectId: "disconnect_spoofed",
          clientId: "client_spoofed",
          startedAt: 2_002,
          recordingStartedAt: null,
          reason: "ice-failed" as const,
        },
      },
      {
        kind: "audio-disconnect-ended" as const,
        disconnect: {
          disconnectId: "disconnect_spoofed",
          clientId: "client_spoofed",
          endedAt: 2_002,
          recordingStartedAt: null,
        },
      },
    ];
    for (const [index, payload] of spoofedPayloads.entries()) {
      await expectDomainError(
        t.mutation(api.recording.sessions.appendSessionEvent, {
          ...ownerGrant,
          eventId: `event_spoofed_${String(index)}`,
          createdAt: 2_002 + index,
          payload,
        }),
        "FORBIDDEN",
      );
    }

    const eventIds = ["event_sort_b", "event_sort_a"];
    for (const eventId of eventIds) {
      await t.mutation(
        api.recording.sessions.appendSessionEvent,
        {
          ...ownerGrant,
          eventId,
          createdAt: 3_000,
          payload: {
            kind: "note",
            note: {
              id: `note_${eventId}`,
              timestamp_ms: 3_000,
              text: eventId,
              author: "Host",
            },
          },
        },
      );
    }
    const secondGrant = {
      clientApiVersion: BBPC_API_VERSION,
      publicId: second.publicId,
      clientId: second.participant.clientId,
      accessToken: second.participant.accessToken,
    };
    await expectDomainError(
      t.mutation(api.recording.sessions.appendSessionEvent, {
        ...secondGrant,
        eventId: "event_sort_a",
        createdAt: 3_001,
        payload: {
          kind: "note-delete",
          id: "note_event_sort_a",
        },
      }),
      "CONFLICT",
    );

    await t.mutation(api.recording.sessions.endSession, ownerGrant);
    await expectDomainError(
      t.mutation(api.recording.sessions.appendSessionEvent, {
        ...ownerGrant,
        eventId: "event_after_end",
        createdAt: 4_000,
        payload: {
          kind: "note-delete",
          id: "note_event_sort_a",
        },
      }),
      "CONFLICT",
    );
    await expect(
      t.mutation(api.recording.sessions.appendSessionEvent, {
        ...ownerGrant,
        eventId: "event_terminal_after_end",
        createdAt: 4_001,
        payload: {
          kind: "recording-left",
          participant: {
            clientId: ownerGrant.clientId,
            leftAt: 4_001,
            recordingStartedAt: 2_000,
            reason: "host-stopped",
          },
        },
      }),
    ).resolves.toBeDefined();

    const events = await t.query(
      api.recording.sessions.listSessionEvents,
      {
        publicId: ownerGrant.publicId,
        clientId: ownerGrant.clientId,
        accessToken: ownerGrant.accessToken,
      },
    );
    expect(events.slice(0, 2).map((event) => event.eventId)).toEqual([
      "event_sort_a",
      "event_sort_b",
    ]);
  });

  test("validates administrative cleanup and explicit deletion", async () => {
    const t = createTestBackend();
    await seedUser(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedUser(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      role: "admin",
    });
    await initializeAtS1(t);
    await advanceToS3(t);
    const input = ownerInput("explicit_delete");
    await t
      .withIdentity(HOST_IDENTITY)
      .mutation(api.recording.sessions.createSession, input);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sessions.cleanupEndedSessions,
        {
          clientApiVersion: BBPC_API_VERSION,
          olderThan: 500,
          limit: 0,
          confirmation: "delete-ended-sessions",
        },
      ),
      "VALIDATION_FAILED",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sessions.cleanupEndedSessions,
        {
          clientApiVersion: BBPC_API_VERSION,
          olderThan: 500,
          limit: 10,
          confirmation: "delete-ended-sessions",
        },
      ),
    ).resolves.toMatchObject({ sessions: 0 });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sessions.deleteSessionData,
        {
          clientApiVersion: BBPC_API_VERSION,
          publicId: "sess_recording_missing_delete",
          confirmation: "delete-session-data",
        },
      ),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sessions.deleteSessionData,
        {
          clientApiVersion: BBPC_API_VERSION,
          publicId: input.publicId,
          confirmation: "delete-session-data",
        },
      ),
    ).resolves.toMatchObject({
      sessions: 1,
      invites: 1,
      participants: 1,
    });
  });
});
