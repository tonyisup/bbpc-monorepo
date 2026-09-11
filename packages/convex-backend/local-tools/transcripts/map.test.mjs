import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordingDate, transcriptFiles, createMapping, writeMapping, main } from "./map.mjs";
import { prepareImports } from "./import.mjs";

test("filename dates are exact calendar dates, including leap years", () => {
  assert.equal(recordingDate("20260908.json"), "2026-09-08");
  assert.equal(recordingDate("20240229.json"), "2024-02-29");
  for (const file of ["20260229.json", "20261301.json", "20260931.json", "20260001.json", "20260900.json", "20260908-partial.json", "other.json", "../20260908.json"])
    assert.throws(() => recordingDate(file));
});

test("uses recording date and canonical ID; completion requires explicit confirmation", async () => {
  const requests = [];
  const client = { query: async (_ref, args) => {
    requests.push(args);
    return { id: "canonical-episode", date: args.date, number: 123 };
  } };
  assert.deepEqual(await createMapping(client, ["20260908.json"]), [
    { file: "20260908.json", episodeId: "canonical-episode", complete: false },
  ]);
  assert.deepEqual(requests, [{ date: "2026-09-08" }]);
  assert.equal((await createMapping(client, ["20260908.json"], { complete: true }))[0].complete, true);
});

test("rejects missing, ambiguous, mismatched and repeated episodes without leaking server errors", async () => {
  const files = ["20260908.json"];
  await assert.rejects(createMapping({ query: async () => null }, files), /no episode/);
  await assert.rejects(createMapping({ query: async () => { throw { data: { code: "CONFLICT" } }; } }, files), /multiple episodes/);
  await assert.rejects(createMapping({ query: async () => { throw new Error("secret server contents"); } }, files), (error) => {
    assert.match(error.message, /lookup failed/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  for (const response of [{ id: "one", date: "2026-09-09" }, { id: "", date: "2026-09-08" }])
    await assert.rejects(createMapping({ query: async () => response }, files), /invalid ID or mismatched/);
  await assert.rejects(createMapping({ query: async (_ref, { date }) => ({ id: "same", date }) }, ["20260908.json", "20260909.json"]), /already mapped/);
  let calls = 0;
  const client = { query: async () => { calls++; } };
  await assert.rejects(createMapping(client, ["20260908.json", "invalid.json"]));
  await assert.rejects(createMapping(client, ["20260908.json", "20260908.json"]));
  assert.equal(calls, 0);
});

test("single-file and sorted directory mappings round trip through importer without overwriting files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "transcript-map-test-"));
  try {
    const source = path.join(directory, "transcripts");
    await mkdir(source);
    await assert.rejects(transcriptFiles(source), /1–1000/);
    for (const file of ["20260909.json", "20260908.json"])
      await writeFile(path.join(source, file), JSON.stringify([{ start: 0, end: 1, text: "Synthetic words" }]));
    await writeFile(path.join(source, "README.md"), "ignored");
    const files = await transcriptFiles(source);
    assert.deepEqual(files, ["20260908.json", "20260909.json"]);
    assert.deepEqual(await transcriptFiles(path.join(source, files[0])), [files[0]]);
    const client = { query: async (_ref, { date }) => ({ id: `episode-${date}`, date }) };
    const draft = await createMapping(client, files);
    await assert.rejects(prepareImports(source, draft), /explicit complete:true/);
    const mapping = await createMapping(client, files, { complete: true });
    const output = path.join(directory, "mapping.json");
    await writeMapping(output, mapping);
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal((await prepareImports(source, saved)).length, 2);
    await assert.rejects(writeMapping(output, draft), { code: "EEXIST" });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), mapping);
    await writeFile(path.join(source, "invalid.json"), "[]");
    await assert.rejects(transcriptFiles(source), /YYYYMMDD/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI requires explicit target guards and pipeline authentication", async () => {
  const args = ["--source", "20260908.json", "--output", "/unused", "--url", "https://intended.convex.cloud"];
  await assert.rejects(main(args, {}), /BBPC_EXPECTED_CONVEX_URL/);
  await assert.rejects(main(args, {
    BBPC_EXPECTED_CONVEX_URL: "https://intended.convex.cloud",
    BBPC_EXPECTED_CONVEX_DEPLOYMENT: "intended",
  }), /BBPC_PIPELINE_ACCESS_TOKEN/);
});
