import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { preparePipelineImport, main } from "./pipeline.mjs";

test("pipeline uses the recording filename when the transcript path is overridden", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pipeline-import-"));
  try {
    const source = path.join(directory, "custom.json");
    await writeFile(source, JSON.stringify([{ start: 0, end: 10, text: "Synthetic film discussion" }]));
    const dates = [];
    const client = { query: async (_ref, args) => {
      dates.push(args.date);
      return { id: "episode-1", date: args.date };
    } };
    const prepared = await preparePipelineImport(client, { source, recordingFile: "/audio/20260908.mp3" });
    assert.deepEqual(dates, ["2026-09-08"]);
    assert.equal(prepared[0].episodeId, "episode-1");
    assert.equal(prepared[0].file, "custom.json");
    // Manual IDs bypass unreliable dates and still go through normal import inspection.
    const explicit = await preparePipelineImport({}, { source, recordingFile: "invalid.mp3", episodeId: "episode-2" });
    assert.equal(explicit[0].episodeId, "episode-2");
    await assert.rejects(preparePipelineImport(client, { source, recordingFile: "20260908-preshow.mp3" }), /Supply --episode-id/);
    await assert.rejects(preparePipelineImport({ query: async () => null }, { source, recordingFile: "20260908.mp3" }), /no episode.*Supply --episode-id/);
    await assert.rejects(preparePipelineImport({ query: async () => { throw { data: { code: "CONFLICT" } }; } }, { source, recordingFile: "20260908.mp3" }), /multiple episodes/);
    await writeFile(source, JSON.stringify([{ start: 10, end: 0, text: "Invalid" }]));
    const before = dates.length;
    await assert.rejects(preparePipelineImport(client, { source, recordingFile: "20260908.mp3" }), /invalid text or timestamps/);
    assert.equal(dates.length, before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("pipeline preflight and completion retain the import target gates", async () => {
  const env = { BBPC_EXPECTED_CONVEX_URL: "https://synthetic.convex.cloud", BBPC_EXPECTED_CONVEX_DEPLOYMENT: "synthetic" };
  await main(["--url", env.BBPC_EXPECTED_CONVEX_URL, "--check-config"], env);
  await assert.rejects(main(["--url", "https://wrong.convex.cloud", "--check-config"], env), /Target must match/);
  await assert.rejects(main(["--url", env.BBPC_EXPECTED_CONVEX_URL, "--check-config"], { ...env, BBPC_FORBIDDEN_CONVEX_DEPLOYMENT: "synthetic" }), /forbidden/);
  await assert.rejects(main(["--url", env.BBPC_EXPECTED_CONVEX_URL, "--source", "partial.json"], env), /confirm-complete/);
});
