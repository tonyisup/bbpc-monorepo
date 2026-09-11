import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertImportTarget,
  requirePipelineToken,
  prepareImports,
  importPrepared,
} from "./import.mjs";

test("rejects deploy keys and malformed pipeline tokens locally without disclosing credentials", () => {
  for (const token of ["dev:synthetic|secret", "prod:synthetic|secret", "mch_secret_synthetic", "Bearer aaa.bbb.ccc", "aaa.bbb", "aaa..ccc"]) {
    assert.throws(() => requirePipelineToken({ BBPC_PIPELINE_ACCESS_TOKEN: token }), (error) => {
      assert.match(error.message, /Clerk M2M JWT.*deploy key/);
      assert.ok(!error.message.includes(token));
      return true;
    });
  }
  assert.throws(() => requirePipelineToken({}), /BBPC_PIPELINE_ACCESS_TOKEN is required/);
  assert.equal(requirePipelineToken({ BBPC_PIPELINE_ACCESS_TOKEN: " aaa.bbb.ccc \n" }), "aaa.bbb.ccc");
});

test("validates files offline, requires explicit completion, and never logs transcript text", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "transcript-test-"));
  try {
    await writeFile(
      path.join(directory, "episode.json"),
      JSON.stringify([{ start: 1, end: 2, text: "Synthetic jellyfish" }])
    );
    const mapping = [
      { file: "episode.json", episodeId: "episode-1", complete: true },
    ];
    const prepared = await prepareImports(directory, mapping);
    assert.equal(prepared[0].passages[0].start, 1);
    await assert.rejects(
      prepareImports(directory, [{ ...mapping[0], complete: false }]),
      /episode\.json: transcription completion is unconfirmed.*explicit complete:true/
    );
    await assert.rejects(prepareImports(directory, []));
    const logs = [];
    await importPrepared(
      {
        query: async () => ({ hash: null, number: 1 }),
        mutation: () => {
          throw new Error("Dry run wrote data");
        },
      },
      prepared,
      { report: (message) => logs.push(message) }
    );
    assert.match(logs[0], /would-replace/);
    assert.doesNotMatch(logs[0], /jellyfish/);
    await writeFile(path.join(directory, "unmapped.json"), "[]");
    await assert.rejects(prepareImports(directory, mapping), /No explicit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates every episode before writing and retries exactly the same request", async () => {
  const prepared = [
    {
      file: "one.json",
      episodeId: "one",
      hash: "new",
      segmentCount: 1,
      passages: [{ start: 0, end: 1, text: "synthetic" }],
    },
  ];
  const requests = [];
  await importPrepared(
    {
      query: async () => ({ hash: "old", number: 1 }),
      mutation: async (_reference, args) => {
        requests.push(args);
        if (requests.length === 1)
          throw new TypeError("Network interrupted after commit");
        return { hash: "new", passageCount: 1, changed: false };
      },
    },
    prepared,
    { apply: true, report: () => undefined }
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[1].expectedHash, "old");
  let writes = 0;
  await assert.rejects(
    importPrepared(
      {
        query: async (_reference, args) => {
          if (args.episodeId === "missing") throw new Error("Missing");
          return { hash: null };
        },
        mutation: async () => {
          writes++;
        },
      },
      [...prepared, { ...prepared[0], episodeId: "missing" }],
      { apply: true, report: () => undefined }
    )
  );
  assert.equal(writes, 0);
});

test("rejects wrong and forbidden deployment targets", () => {
  assert.equal(
    assertImportTarget("http://127.0.0.1:3320", {
      BBPC_EXPECTED_CONVEX_URL: "http://127.0.0.1:3320",
    }),
    "http://127.0.0.1:3320"
  );
  assert.throws(() => assertImportTarget("https://example.test", {}));
  const env = {
    BBPC_EXPECTED_CONVEX_URL: "https://synthetic-test-123.convex.cloud",
    BBPC_EXPECTED_CONVEX_DEPLOYMENT: "synthetic-test-123",
  };
  assert.equal(
    assertImportTarget(env.BBPC_EXPECTED_CONVEX_URL, env),
    env.BBPC_EXPECTED_CONVEX_URL
  );
  assert.throws(() =>
    assertImportTarget(env.BBPC_EXPECTED_CONVEX_URL, {
      ...env,
      BBPC_FORBIDDEN_CONVEX_DEPLOYMENT: "synthetic-test-123",
    })
  );
  assert.throws(() =>
    assertImportTarget("https://synthetic-test-124.convex.cloud", env)
  );
  assert.throws(() =>
    assertImportTarget("https://user:password@example.test", env)
  );
});
