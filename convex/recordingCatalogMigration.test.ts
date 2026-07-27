/// <reference types="vite/client" />

import { createHash } from "node:crypto";

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "recording-catalog-migration-test";

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

async function initialize(
  t: TestBackend,
  enterS1: boolean,
): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "recording-catalog-migration-test",
  });
  if (enterS1) {
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S0",
      nextStage: "S1",
      actor: "recording-catalog-migration-test",
    });
  }
}

const sounder = {
  id: "soundboard-one-mp3",
  blobName: "Soundboard/one.mp3",
  name: "One",
  category: "Soundboard",
  url: "/api/sounders/play?path=Soundboard%2Fone.mp3",
  duration: 100,
  size: 1_024,
  contentType: "audio/mpeg",
};
const sounders = [sounder];
const template = {
  id: "segment_one",
  label: "Segment One",
  type: "segment" as const,
  introSounder: "Soundboard/one.mp3",
};
const templates = [template];
const canonicalCatalogs = {
  sounders: sounders.map((sounder, sortOrder) => ({
    ...sounder,
    sortOrder,
  })),
  templates: templates.map((template, sortOrder) => ({
    ...template,
    sortOrder,
  })),
};
const sourceDigest = `sha256:${createHash("sha256")
  .update(JSON.stringify(canonicalCatalogs))
  .digest("hex")}`;
const importArgs = {
  cutoverRunId: CUTOVER_RUN_ID,
  operationId: "recording.catalogs.import",
  sourceDigest,
  sourceObservedAt: 1_000,
  sounders,
  templates,
};

describe("recording catalog migration", () => {
  test("requires the S1 migration gate and exact operation", async () => {
    const t = createTestBackend();
    await initialize(t, false);
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        importArgs,
      ),
      "WRITE_DISABLED",
    );

    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S0",
      nextStage: "S1",
      actor: "recording-catalog-migration-test",
    });
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          operationId: "recording.catalogs.wrong",
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("imports idempotently and exposes aggregate reconciliation evidence", async () => {
    const t = createTestBackend();
    await initialize(t, true);

    await expect(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        importArgs,
      ),
    ).resolves.toEqual({
      imported: true,
      sounders: 1,
      templates: 1,
      digest: sourceDigest,
    });
    await expect(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        importArgs,
      ),
    ).resolves.toEqual({
      imported: false,
      sounders: 1,
      templates: 1,
      digest: sourceDigest,
    });

    await expect(
      t.query(
        internal.migration.recordingCatalog
          .inspectRecordingCatalogs,
        {
          expectedDigest: sourceDigest,
          expectedSounders: 1,
          expectedTemplates: 1,
        },
      ),
    ).resolves.toEqual({
      sounders: 1,
      templates: 1,
      digest: sourceDigest,
      countsMatch: true,
      digestMatches: true,
    });
    await expect(
      t.query(api.recording.sounders.list, {}),
    ).resolves.toMatchObject(sounders);
    await expect(
      t.query(api.recording.templates.list, {}),
    ).resolves.toMatchObject([
      {
        ...templates[0],
        outroSounder: null,
        sortOrder: 0,
      },
    ]);

    const audits = await t.run(async (ctx) =>
      await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20),
    );
    const catalogAudits = audits.filter(
      (event) =>
        event.action ===
        "migration.recording.catalogsImported",
    );
    expect(catalogAudits).toHaveLength(1);
    const auditJson = JSON.stringify(catalogAudits);
    expect(auditJson).not.toContain(sounders[0]?.name);
    expect(auditJson).not.toContain(
      sounders[0]?.blobName,
    );
  });

  test("rejects checksum drift and conflicting stored catalogs", async () => {
    const t = createTestBackend();
    await initialize(t, true);
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sourceDigest: `sha256:${"0".repeat(64)}`,
        },
      ),
      "CONFLICT",
    );

    await t.mutation(
      internal.migration.recordingCatalog
        .importRecordingCatalogs,
      importArgs,
    );
    const sourceSounder = sounders.at(0);
    if (sourceSounder === undefined) {
      throw new Error("Expected a recording sounder fixture.");
    }
    const changedSounders = [
      {
        ...sourceSounder,
        name: "Changed",
      },
    ];
    const changedCatalogs = {
      sounders: changedSounders.map(
        (sounder, sortOrder) => ({
          ...sounder,
          sortOrder,
        }),
      ),
      templates: canonicalCatalogs.templates,
    };
    const changedDigest = `sha256:${createHash("sha256")
      .update(JSON.stringify(changedCatalogs))
      .digest("hex")}`;
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sourceDigest: changedDigest,
          sounders: changedSounders,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects malformed digests, duplicate keys, and oversized imports", async () => {
    const t = createTestBackend();
    await initialize(t, true);

    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sourceDigest: "not-a-digest",
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sounders: [sounder, sounder],
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sounders: [
            sounder,
            {
              ...sounder,
              id: "soundboard-two-mp3",
            },
          ],
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          templates: [template, template],
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sounders: Array.from(
            { length: 1_001 },
            (_, index) => ({
              ...sounder,
              id: `sounder-${String(index)}`,
              blobName: `Soundboard/${String(index)}.mp3`,
            }),
          ),
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.mutation(
        internal.migration.recordingCatalog
          .importRecordingCatalogs,
        {
          ...importArgs,
          sounders: [],
          templates: Array.from(
            { length: 101 },
            (_, index) => ({
              ...template,
              id: `template-${String(index)}`,
            }),
          ),
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("preserves optional template fields and reports reconciliation drift", async () => {
    const t = createTestBackend();
    await initialize(t, true);
    const expandedSounders = [
      sounder,
      {
        ...sounder,
        id: "soundboard-two-mp3",
        blobName: "Soundboard/two.mp3",
        name: "Two",
      },
    ];
    const expandedTemplates = [
      template,
      {
        id: "outro_two",
        label: "Outro Two",
        type: "outro" as const,
        outroSounder: "Soundboard/two.mp3",
        sortOrder: 7,
      },
    ];
    const expandedCanonical = {
      sounders: expandedSounders.map(
        (sounder, sortOrder) => ({
          ...sounder,
          sortOrder,
        }),
      ),
      templates: [
        {
          ...template,
          sortOrder: 0,
        },
        {
          ...expandedTemplates[1],
          sortOrder: 7,
        },
      ],
    };
    const expandedDigest = `sha256:${createHash("sha256")
      .update(JSON.stringify(expandedCanonical))
      .digest("hex")}`;

    await t.mutation(
      internal.migration.recordingCatalog
        .importRecordingCatalogs,
      {
        ...importArgs,
        sourceDigest: expandedDigest,
        sounders: expandedSounders,
        templates: expandedTemplates,
      },
    );

    await expect(
      t.query(
        internal.migration.recordingCatalog
          .inspectRecordingCatalogs,
        {
          expectedDigest: `  ${expandedDigest.toUpperCase()}  `,
          expectedSounders: 99,
          expectedTemplates: 98,
        },
      ),
    ).resolves.toMatchObject({
      sounders: 2,
      templates: 2,
      countsMatch: false,
      digestMatches: true,
    });
    await expect(
      t.query(api.recording.templates.list, {}),
    ).resolves.toContainEqual({
      id: "outro_two",
      label: "Outro Two",
      type: "outro",
      introSounder: null,
      outroSounder: "Soundboard/two.mp3",
      sortOrder: 7,
    });
  });

  test("rejects stored catalogs above the reconciliation bound", async () => {
    const t = createTestBackend();
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert(
          "recordingSegmentTemplates",
          {
            templateId: `template-${String(index)}`,
            label: `Template ${String(index)}`,
            type: "segment",
            sortOrder: index,
            updatedAt: 1_000,
          },
        );
      }
    });

    await expectDomainError(
      t.query(
        internal.migration.recordingCatalog
          .inspectRecordingCatalogs,
        {
          expectedDigest: sourceDigest,
          expectedSounders: 0,
          expectedTemplates: 101,
        },
      ),
      "CONFLICT",
    );
  });
});
