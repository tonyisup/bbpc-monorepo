/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "recording-media-test";
const HOST_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-media-host",
  issuer: "https://issuer.example.test",
  subject: "recording-media-host",
};
const ADMIN_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|recording-media-admin",
  issuer: "https://issuer.example.test",
  subject: "recording-media-admin",
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
    name: string;
    email: string;
    role: "host" | "admin";
  },
) {
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
    const roleId = await ctx.db.insert("roles", {
      name:
        input.role === "admin" ? "Administrator" : "Host",
      normalizedName:
        input.role === "admin" ? "administrator" : "host",
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
    return userId;
  });
}

async function seedS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "recording-media-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "recording-media-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "recording-media-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "recording-media-test",
    approvedBackupId: "recording-media-backup",
    approvedBackupChecksum: "sha256:recording-media",
  });
}

function sessionInput(suffix: string) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    publicId: `sess_media_${suffix}`,
    inviteToken: `inv_media_${suffix}_abcdefghijklmnopqrstuvwxyz`,
    episode: `EP-${suffix}`,
    createdAt: 1_000,
    participant: {
      clientId: `client_media_${suffix}`,
      accessToken:
        `access_media_${suffix}_abcdefghijklmnopqrstuvwxyz`,
      displayName: "Media Host",
      joinedAt: 1_000,
    },
  };
}

async function createHostSession(
  t: TestBackend,
  suffix: string,
) {
  const input = sessionInput(suffix);
  await t
    .withIdentity(HOST_IDENTITY)
    .mutation(api.recording.sessions.createSession, input);
  return {
    input,
    grant: {
      clientApiVersion: BBPC_API_VERSION,
      publicSessionId: input.publicId,
      clientId: input.participant.clientId,
      accessToken: input.participant.accessToken,
    },
  };
}

describe("shared recording media and catalogs", () => {
  test("keeps upload ownership canonical and idempotent", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedS3(t);
    const first = await createHostSession(t, "one");
    const second = await createHostSession(t, "two");
    const upload = {
      episode: first.input.episode,
      hostName: "Media Host",
      trackType: "mic" as const,
      startedAt: 1_001,
      blobName: "session/host-mic.webm",
      url: "https://audio.example.test/host-mic.webm",
      size: 123,
      contentType: "audio/webm",
      uploadedAt: 1_002,
    };
    const uploadId = await t.mutation(
      api.recording.recordings.saveUpload,
      {
        ...first.grant,
        ...upload,
      },
    );
    const replayId = await t.mutation(
      api.recording.recordings.saveUpload,
      {
        ...first.grant,
        ...upload,
        size: 456,
      },
    );
    expect(replayId).toBe(uploadId);
    const listed = await t.query(
      api.recording.recordings.listBySession,
      {
        publicSessionId: first.grant.publicSessionId,
        clientId: first.grant.clientId,
        accessToken: first.grant.accessToken,
      },
    );
    expect(listed).toMatchObject([
      {
        id: uploadId,
        hostName: "Media Host",
        size: 456,
      },
    ]);
    await expectDomainError(
      t.mutation(api.recording.recordings.saveUpload, {
        ...second.grant,
        ...upload,
        episode: second.input.episode,
      }),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(api.recording.recordings.saveUpload, {
        ...first.grant,
        ...upload,
        hostName: "Spoofed Host",
      }),
      "CONFLICT",
    );
  });

  test("allows only the owner to persist a bounded manifest", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedS3(t);
    const session = await createHostSession(t, "manifest");
    const guest = {
      clientApiVersion: BBPC_API_VERSION,
      inviteToken: session.input.inviteToken,
      participant: {
        clientId: "client_manifest_guest",
        accessToken:
          "access_manifest_guest_abcdefghijklmnopqrstuvwxyz",
        displayName: "Guest",
        joinedAt: 1_001,
      },
    };
    await t.mutation(
      api.recording.sessions.joinSessionByInviteToken,
      guest,
    );
    const manifest = {
      episode: session.input.episode,
      date: "2026-07-27",
      hosts: ["Media Host", "Guest"],
      manifestVersion: "1.0",
      manifest: { notes: [], segments: [] },
      updatedAt: 1_100,
    };
    await expectDomainError(
      t.mutation(api.recording.manifests.save, {
        clientApiVersion: BBPC_API_VERSION,
        publicSessionId: session.input.publicId,
        clientId: guest.participant.clientId,
        accessToken: guest.participant.accessToken,
        ...manifest,
      }),
      "FORBIDDEN",
    );
    const manifestId = await t.mutation(
      api.recording.manifests.save,
      {
        ...session.grant,
        ...manifest,
      },
    );
    const replayId = await t.mutation(
      api.recording.manifests.save,
      {
        ...session.grant,
        ...manifest,
        manifest: { notes: [{ text: "updated" }] },
        updatedAt: 1_101,
      },
    );
    expect(replayId).toBe(manifestId);
    const loaded = await t.query(
      api.recording.manifests.getBySession,
      {
        publicSessionId: session.input.publicId,
        clientId: guest.participant.clientId,
        accessToken: guest.participant.accessToken,
      },
    );
    expect(loaded).toMatchObject({
      manifestVersion: "1.0",
      updatedAt: 1_101,
      manifest: { notes: [{ text: "updated" }] },
    });
    await expectDomainError(
      t.mutation(api.recording.manifests.save, {
        ...session.grant,
        ...manifest,
        date: "2026-02-30",
      }),
      "VALIDATION_FAILED",
    );
  });

  test("replaces and validates session favorites atomically", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedS3(t);
    const session = await createHostSession(t, "favorites");
    const firstFavorite = {
      id: "sounder_one",
      name: "One",
      category: "Drops",
      duration: 500,
      url: "/api/sounders/play?path=one.mp3",
    };
    const favorites = [
      firstFavorite,
      {
        id: "sounder_two",
        name: "Two",
        category: "Drops",
        duration: 700,
        url: "https://audio.example.test/two.mp3",
      },
    ];
    await expect(
      t.mutation(api.recording.favorites.replaceAll, {
        ...session.grant,
        favorites,
        updatedAt: 1_200,
      }),
    ).resolves.toEqual({ count: 2 });
    const listed = await t.query(
      api.recording.favorites.list,
      {
        publicSessionId: session.input.publicId,
        clientId: session.grant.clientId,
        accessToken: session.grant.accessToken,
      },
    );
    expect(listed.map((favorite) => favorite.id)).toEqual([
      "sounder_one",
      "sounder_two",
    ]);
    await expectDomainError(
      t.mutation(api.recording.favorites.replaceAll, {
        ...session.grant,
        favorites: [firstFavorite, firstFavorite],
        updatedAt: 1_201,
      }),
      "VALIDATION_FAILED",
    );
  });

  test("uses administrator-only bounded template and sounder writes", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedIdentity(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      role: "admin",
    });
    await seedS3(t);
    const templates = [
      {
        id: "intro",
        label: "Intro",
        type: "intro" as const,
        introSounder: "sounder_one",
      },
    ];
    await expectDomainError(
      t.withIdentity(HOST_IDENTITY).mutation(
        api.recording.templates.upsertMany,
        {
          clientApiVersion: BBPC_API_VERSION,
          templates,
          updatedAt: 1_300,
        },
      ),
      "FORBIDDEN",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.templates.upsertMany,
        {
          clientApiVersion: BBPC_API_VERSION,
          templates,
          updatedAt: 1_300,
        },
      ),
    ).resolves.toEqual({ count: 1 });
    expect(
      await t.query(api.recording.templates.list, {}),
    ).toMatchObject([
      {
        id: "intro",
        introSounder: "sounder_one",
        outroSounder: null,
      },
    ]);

    const firstSounder = {
      id: "sounder_one",
      blobName: "drops/one.mp3",
      name: "One",
      category: "Drops",
      url: "/api/sounders/play?path=drops%2Fone.mp3",
      duration: 500,
      size: 1_024,
      contentType: "audio/mpeg",
    };
    const sounders = [firstSounder];
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sounders.replaceAll,
        {
          clientApiVersion: BBPC_API_VERSION,
          sounders,
          updatedAt: 1_301,
        },
      ),
    ).resolves.toEqual({ count: 1 });
    expect(
      await t.query(api.recording.sounders.list, {}),
    ).toMatchObject(sounders);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sounders.replaceAll,
        {
          clientApiVersion: BBPC_API_VERSION,
          sounders: [firstSounder, firstSounder],
          updatedAt: 1_302,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sounders.replaceAll,
        {
          clientApiVersion: BBPC_API_VERSION,
          sounders: [
            {
              ...firstSounder,
              blobName: "drops/\u0000one.mp3",
            },
          ],
          updatedAt: 1_303,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("rejects malformed uploads and enforces per-session capacity", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedS3(t);
    const session = await createHostSession(t, "upload_limits");
    const upload = {
      episode: session.input.episode,
      hostName: "Media Host",
      trackType: "mic" as const,
      startedAt: 1_001,
      blobName: "session/valid.webm",
      url: "https://audio.example.test/valid.webm",
      size: 123,
      contentType: "audio/webm",
      uploadedAt: 1_002,
    };

    const invalidUploads = [
      { ...upload, episode: "EP-WRONG" },
      { ...upload, hostName: "   " },
      { ...upload, url: "not a url" },
      { ...upload, url: "http://audio.example.test/valid.webm" },
      { ...upload, size: 0 },
    ];
    for (const invalidUpload of invalidUploads) {
      await expectDomainError(
        t.mutation(api.recording.recordings.saveUpload, {
          ...session.grant,
          ...invalidUpload,
        }),
        invalidUpload.episode === "EP-WRONG"
          ? "CONFLICT"
          : "VALIDATION_FAILED",
      );
    }

    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("recordingUploads", {
          publicSessionId: session.input.publicId,
          episode: session.input.episode,
          hostName: `Host ${String(index).padStart(3, "0")}`,
          trackType: "mic",
          startedAt: 2_000,
          blobName: `session/capacity-${String(index)}.webm`,
          url: `https://audio.example.test/capacity-${String(index)}.webm`,
          size: 1,
          contentType: "audio/webm",
          uploadedAt: 2_001,
        });
      }
    });
    await expectDomainError(
      t.mutation(api.recording.recordings.saveUpload, {
        ...session.grant,
        ...upload,
        blobName: "session/over-capacity.webm",
      }),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("recordingUploads", {
        publicSessionId: session.input.publicId,
        episode: session.input.episode,
        hostName: "Overflow",
        trackType: "sounders",
        startedAt: 3_000,
        blobName: "session/direct-overflow.webm",
        url: "https://audio.example.test/direct-overflow.webm",
        size: 1,
        contentType: "audio/webm",
        uploadedAt: 3_001,
      });
    });
    await expectDomainError(
      t.query(api.recording.recordings.listBySession, {
        publicSessionId: session.grant.publicSessionId,
        clientId: session.grant.clientId,
        accessToken: session.grant.accessToken,
      }),
      "CONFLICT",
    );
  });

  test("fails closed on ambiguous uploads and corrupt ownership", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedS3(t);
    const first = await createHostSession(t, "upload_corrupt_one");
    const second = await createHostSession(t, "upload_corrupt_two");
    const upload = {
      episode: first.input.episode,
      hostName: "Media Host",
      trackType: "mic" as const,
      startedAt: 1_001,
      blobName: "session/ambiguous.webm",
      url: "https://audio.example.test/ambiguous.webm",
      size: 123,
      contentType: "audio/webm",
      uploadedAt: 1_002,
    };

    await t.run(async (ctx) => {
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("recordingUploads", {
          publicSessionId: first.input.publicId,
          episode: first.input.episode,
          hostName: "Media Host",
          trackType: "mic",
          startedAt: 1_001,
          blobName: upload.blobName,
          url: upload.url,
          size: index + 1,
          contentType: "audio/webm",
          uploadedAt: 1_002,
        });
      }
    });
    await expectDomainError(
      t.mutation(api.recording.recordings.saveUpload, {
        ...first.grant,
        ...upload,
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
              .eq("publicSessionId", first.input.publicId)
              .eq("clientId", first.grant.clientId),
        )
        .unique();
      const secondSession = await ctx.db
        .query("recordingSessions")
        .withIndex("by_publicId", (query) =>
          query.eq("publicId", second.input.publicId),
        )
        .unique();
      if (participant === null || secondSession === null) {
        throw new Error("Expected upload ownership fixtures.");
      }
      await ctx.db.patch(
        "recordingParticipants",
        participant._id,
        { sessionId: secondSession._id },
      );
    });
    await expectDomainError(
      t.mutation(api.recording.recordings.saveUpload, {
        ...first.grant,
        ...upload,
        blobName: "session/corrupt.webm",
      }),
      "CONFLICT",
    );
  });

  test("validates manifest metadata and duplicate storage", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedS3(t);
    const session = await createHostSession(t, "manifest_validation");
    const grant = {
      publicSessionId: session.grant.publicSessionId,
      clientId: session.grant.clientId,
      accessToken: session.grant.accessToken,
    };
    await expect(
      t.query(api.recording.manifests.getBySession, grant),
    ).resolves.toBeNull();

    const manifest = {
      ...session.grant,
      episode: session.input.episode,
      date: "2026-07-27",
      hosts: ["Media Host"],
      manifestVersion: "1.0",
      manifest: { segments: [] },
      updatedAt: 1_100,
    };
    const invalidManifests = [
      { ...manifest, episode: "EP-WRONG" },
      { ...manifest, date: "07/27/2026" },
      { ...manifest, hosts: [] },
      { ...manifest, hosts: ["Media Host", "Media Host"] },
      { ...manifest, manifestVersion: "bad version" },
    ];
    for (const invalidManifest of invalidManifests) {
      await expectDomainError(
        t.mutation(
          api.recording.manifests.save,
          invalidManifest,
        ),
        invalidManifest.episode === "EP-WRONG"
          ? "CONFLICT"
          : "VALIDATION_FAILED",
      );
    }

    await t.run(async (ctx) => {
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("recordingSessionManifests", {
          publicSessionId: session.input.publicId,
          episode: session.input.episode,
          date: "2026-07-27",
          hosts: ["Media Host"],
          manifestVersion: `seed-${String(index)}`,
          manifest: { index },
          updatedAt: 1_200 + index,
        });
      }
    });
    await expectDomainError(
      t.mutation(api.recording.manifests.save, manifest),
      "CONFLICT",
    );
    await expectDomainError(
      t.query(api.recording.manifests.getBySession, grant),
      "CONFLICT",
    );
  });

  test("bounds favorites and updates both catalog shapes", async () => {
    const t = createTestBackend();
    await seedIdentity(t, {
      identity: HOST_IDENTITY,
      name: "Host",
      email: "host@example.test",
      role: "host",
    });
    await seedIdentity(t, {
      identity: ADMIN_IDENTITY,
      name: "Admin",
      email: "admin@example.test",
      role: "admin",
    });
    await seedS3(t);
    const session = await createHostSession(t, "catalog_limits");
    const favorite = {
      id: "favorite",
      name: "Favorite",
      category: "Drops",
      duration: 100,
      url: "/favorite.mp3",
    };
    await expectDomainError(
      t.mutation(api.recording.favorites.replaceAll, {
        ...session.grant,
        favorites: Array.from({ length: 101 }, (_, index) => ({
          ...favorite,
          id: `favorite_${String(index)}`,
        })),
        updatedAt: 1_300,
      }),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("recordingSessionFavorites", {
          publicSessionId: session.input.publicId,
          sounderId: `favorite_${String(index)}`,
          name: `Favorite ${String(index)}`,
          category: "Drops",
          duration: 100,
          url: "/favorite.mp3",
          sortOrder: index,
          updatedAt: 1_300,
        });
      }
    });
    await expectDomainError(
      t.query(api.recording.favorites.list, {
        publicSessionId: session.grant.publicSessionId,
        clientId: session.grant.clientId,
        accessToken: session.grant.accessToken,
      }),
      "CONFLICT",
    );
    await expectDomainError(
      t.mutation(api.recording.favorites.replaceAll, {
        ...session.grant,
        favorites: [],
        updatedAt: 1_301,
      }),
      "CONFLICT",
    );

    const firstTemplate = {
      id: "template_update",
      label: "Initial",
      type: "segment" as const,
      outroSounder: "Soundboard/outro.mp3",
    };
    const templateInput = {
      clientApiVersion: BBPC_API_VERSION,
      templates: [firstTemplate],
      updatedAt: 1_400,
    };
    await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(
        api.recording.templates.upsertMany,
        templateInput,
      );
    await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.recording.templates.upsertMany, {
        ...templateInput,
        templates: [
          {
            id: "template_update",
            label: "Updated",
            type: "outro",
          },
        ],
        updatedAt: 1_401,
      });
    expect(
      await t.query(api.recording.templates.list, {}),
    ).toMatchObject([
      {
        id: "template_update",
        label: "Updated",
        introSounder: null,
        outroSounder: null,
        sortOrder: 0,
      },
    ]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.templates.upsertMany,
        {
          clientApiVersion: BBPC_API_VERSION,
          templates: [
            firstTemplate,
            firstTemplate,
          ],
          updatedAt: 1_402,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.templates.upsertMany,
        {
          clientApiVersion: BBPC_API_VERSION,
          templates: Array.from(
            { length: 101 },
            (_, index) => ({
              id: `template_${String(index)}`,
              label: `Template ${String(index)}`,
              type: "segment" as const,
            }),
          ),
          updatedAt: 1_403,
        },
      ),
      "VALIDATION_FAILED",
    );

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.recording.sounders.replaceAll,
        {
          clientApiVersion: BBPC_API_VERSION,
          sounders: Array.from(
            { length: 1_001 },
            (_, index) => ({
              id: `sounder_${String(index)}`,
              blobName: `sounders/${String(index)}.mp3`,
              name: `Sounder ${String(index)}`,
              category: "Drops",
              url: `/sounders/${String(index)}.mp3`,
              duration: 100,
              size: 100,
              contentType: "audio/mpeg",
            }),
          ),
          updatedAt: 1_500,
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("orders sounders deterministically across every tie breaker", async () => {
    const t = createTestBackend();
    await t.run(async (ctx) => {
      const fixtures = [
        {
          sounderId: "sounder_category_b_name_b",
          name: "B",
          category: "B",
          sortOrder: 1,
        },
        {
          sounderId: "sounder_sort_zero",
          name: "Z",
          category: "Z",
          sortOrder: 0,
        },
        {
          sounderId: "sounder_category_a",
          name: "X",
          category: "A",
          sortOrder: 1,
        },
        {
          sounderId: "sounder_category_b_name_a",
          name: "A",
          category: "B",
          sortOrder: 1,
        },
      ];
      for (const fixture of fixtures) {
        await ctx.db.insert("recordingSounders", {
          ...fixture,
          blobName: `${fixture.sounderId}.mp3`,
          url: `/${fixture.sounderId}.mp3`,
          duration: 100,
          size: 100,
          contentType: "audio/mpeg",
          updatedAt: 1,
        });
      }
    });
    const sounders = await t.query(
      api.recording.sounders.list,
      {},
    );
    expect(sounders.map((sounder) => sounder.id)).toEqual([
      "sounder_sort_zero",
      "sounder_category_a",
      "sounder_category_b_name_a",
      "sounder_category_b_name_b",
    ]);
  });
});
