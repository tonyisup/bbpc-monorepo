/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "recording-rtc-test";
const HOST_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-rtc-host",
  issuer: "https://issuer.example.test",
  subject: "recording-rtc-host",
};
const ADMIN_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-rtc-admin",
  issuer: "https://issuer.example.test",
  subject: "recording-rtc-admin",
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

async function seedIdentity(
  t: TestBackend,
  input: {
    identity: typeof HOST_IDENTITY;
    role: "host" | "admin";
  },
) {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: input.role,
      email: `${input.role}@example.test`,
      normalizedEmail: `${input.role}@example.test`,
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
    const roleId = await ctx.db.insert("roles", {
      name:
        input.role === "admin" ? "Administrator" : "Host",
      normalizedName:
        input.role === "admin" ? "administrator" : "host",
      description: input.role,
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
  });
}

async function seedS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "recording-rtc-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "recording-rtc-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "recording-rtc-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "recording-rtc-test",
    approvedBackupId: "recording-rtc-backup",
    approvedBackupChecksum: "sha256:recording-rtc",
  });
}

async function seedSession(t: TestBackend) {
  const input = {
    clientApiVersion: BBPC_API_VERSION,
    publicId: "sess_rtc_abcdefghijklmnopqrstuvwxyz",
    inviteToken: "inv_rtc_abcdefghijklmnopqrstuvwxyz",
    episode: "EP-RTC",
    createdAt: 1_000,
    participant: {
      clientId: "client_rtc_owner",
      accessToken: "access_rtc_owner_abcdefghijklmnopqrstuvwxyz",
      displayName: "RTC Host",
      joinedAt: 1_000,
    },
  };
  await t
    .withIdentity(HOST_IDENTITY)
    .mutation(api.recording.sessions.createSession, input);
  return {
    input,
    ownerGrant: {
      clientApiVersion: BBPC_API_VERSION,
      publicSessionId: input.publicId,
      clientId: input.participant.clientId,
      accessToken: input.participant.accessToken,
    },
  };
}

async function joinGuest(
  t: TestBackend,
  inviteToken: string,
  index: number,
) {
  const participant = {
    clientId: `client_rtc_guest_${String(index)}`,
    accessToken:
      `access_rtc_guest_${String(index)}_abcdefghijklmnopqrstuvwxyz`,
    displayName: `Guest ${String(index)}`,
    joinedAt: 1_000 + index,
  };
  await t.mutation(
    api.recording.sessions.joinSessionByInviteToken,
    {
      clientApiVersion: BBPC_API_VERSION,
      inviteToken,
      participant,
    },
  );
  return {
    clientApiVersion: BBPC_API_VERSION,
    publicSessionId:
      "sess_rtc_abcdefghijklmnopqrstuvwxyz",
    clientId: participant.clientId,
    accessToken: participant.accessToken,
  };
}

describe("shared recording RTC boundary", () => {
  test("enforces room capacity and refreshes presence", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      role: "host",
    });
    await seedS3(t);
    const { input, ownerGrant } = await seedSession(t);
    const [
      guestOne,
      guestTwo,
      guestThree,
      guestFour,
    ] = await Promise.all([
      joinGuest(t, input.inviteToken, 1),
      joinGuest(t, input.inviteToken, 2),
      joinGuest(t, input.inviteToken, 3),
      joinGuest(t, input.inviteToken, 4),
    ]);
    const activeGuests = [
      guestOne,
      guestTwo,
      guestThree,
    ];
    await expect(
      t.mutation(api.recording.rtc.joinAudio, {
        ...ownerGrant,
        muted: false,
        recording: true,
      }),
    ).resolves.toEqual({ ok: true });
    for (const guest of activeGuests) {
      await expect(
        t.mutation(api.recording.rtc.joinAudio, {
          ...guest,
          muted: true,
          recording: false,
        }),
      ).resolves.toEqual({ ok: true });
    }
    await expect(
      t.mutation(api.recording.rtc.joinAudio, {
        ...guestFour,
        muted: true,
        recording: false,
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "room-full",
    });
    await expect(
      t.mutation(api.recording.rtc.heartbeatAudio, {
        ...guestOne,
        muted: false,
        recording: true,
      }),
    ).resolves.toEqual({ ok: true });
    const presence = await t.query(
      api.recording.rtc.listAudioPresence,
      {
        publicSessionId: ownerGrant.publicSessionId,
        clientId: ownerGrant.clientId,
        accessToken: ownerGrant.accessToken,
      },
    );
    expect(presence).toHaveLength(4);
    expect(
      presence.find(
        (row) => row.clientId === guestOne.clientId,
      ),
    ).toMatchObject({
      muted: false,
      recording: true,
    });
    await expect(
      t.mutation(api.recording.rtc.leaveAudio, guestOne),
    ).resolves.toEqual({ ok: true });
    await expect(
      t.mutation(api.recording.rtc.heartbeatAudio, {
        ...guestOne,
        muted: false,
        recording: false,
      }),
    ).resolves.toBeNull();
  });

  test("delivers bounded idempotent signals only to session participants", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      role: "host",
    });
    await seedS3(t);
    const { input, ownerGrant } = await seedSession(t);
    const guest = await joinGuest(
      t,
      input.inviteToken,
      1,
    );
    const signal = {
      ...ownerGrant,
      toClientId: guest.clientId,
      signalId: "signal_offer_01",
      type: "offer" as const,
      payload: { sdp: "offer" },
    };
    await expect(
      t.mutation(api.recording.rtc.sendSignal, signal),
    ).resolves.toEqual({ ok: true });
    await expect(
      t.mutation(api.recording.rtc.sendSignal, signal),
    ).resolves.toEqual({ ok: true });
    await expect(
      t.mutation(api.recording.rtc.sendSignal, {
        ...signal,
        toClientId: "client_missing_recipient",
        signalId: "signal_missing_01",
      }),
    ).resolves.toBeNull();
    const signals = await t.query(
      api.recording.rtc.listSignalsForParticipant,
      {
        publicSessionId: guest.publicSessionId,
        clientId: guest.clientId,
        accessToken: guest.accessToken,
        now: Date.now(),
      },
    );
    expect(signals).toMatchObject([
      {
        fromClientId: ownerGrant.clientId,
        toClientId: guest.clientId,
        signalId: "signal_offer_01",
        type: "offer",
        payload: { sdp: "offer" },
      },
    ]);
    await expectDomainError(
      t.mutation(api.recording.rtc.sendSignal, {
        ...signal,
        toClientId: ownerGrant.clientId,
      }),
      "CONFLICT",
    );
  });

  test("rejects oversized signals and ended-session joins", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      role: "host",
    });
    await seedS3(t);
    const { input, ownerGrant } = await seedSession(t);
    const guest = await joinGuest(
      t,
      input.inviteToken,
      1,
    );
    await expectDomainError(
      t.mutation(api.recording.rtc.sendSignal, {
        ...ownerGrant,
        toClientId: guest.clientId,
        signalId: "signal_oversized",
        type: "offer",
        payload: { sdp: "x".repeat(70_000) },
      }),
      "VALIDATION_FAILED",
    );
    await t.mutation(api.recording.sessions.endSession, {
      clientApiVersion: BBPC_API_VERSION,
      publicId: ownerGrant.publicSessionId,
      clientId: ownerGrant.clientId,
      accessToken: ownerGrant.accessToken,
    });
    await expectDomainError(
      t.mutation(api.recording.rtc.joinAudio, {
        ...ownerGrant,
        muted: false,
        recording: false,
      }),
      "CONFLICT",
    );
  });

  test("allows only administrators to clean bounded stale RTC rows", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      role: "host",
    });
    await seedIdentity(t, {
      identity: ADMIN_IDENTITY,
      role: "admin",
    });
    await seedS3(t);
    const { input, ownerGrant } = await seedSession(t);
    const guest = await joinGuest(
      t,
      input.inviteToken,
      1,
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("recordingRtcPresence", {
        publicSessionId: ownerGrant.publicSessionId,
        clientId: guest.clientId,
        displayName: "Guest 1",
        role: "participant",
        joinedAudioAt: 1,
        lastSeenAt: 1,
        muted: false,
        recording: false,
      });
      await ctx.db.insert("recordingRtcSignals", {
        publicSessionId: ownerGrant.publicSessionId,
        fromClientId: ownerGrant.clientId,
        toClientId: guest.clientId,
        signalId: "signal_stale_01",
        createdAt: 1,
        type: "offer",
        payload: {},
      });
    });
    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.rtc.cleanupRtcSession,
        {
          clientApiVersion: BBPC_API_VERSION,
          publicSessionId: ownerGrant.publicSessionId,
          olderThan: 2,
        },
      ),
      "FORBIDDEN",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.rtc.cleanupRtcSession,
        {
          clientApiVersion: BBPC_API_VERSION,
          publicSessionId: ownerGrant.publicSessionId,
          olderThan: 2,
        },
      ),
    ).resolves.toEqual({
      deletedPresence: 1,
      deletedSignals: 1,
    });
  });
});
