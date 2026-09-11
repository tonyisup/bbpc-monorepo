import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { matchBlobs, buildPlan, executePlan, main, readCatalog } from "./backfill.mjs";
import { prepareImports } from "./import.mjs";

const base = "https://synthetic.blob.core.windows.net/episodes";
const url = "https://synthetic.convex.cloud";
const episode = (id, number, date, title = `Title ${number}`, extra = {}) => ({ id, number, date, title, status: "published", ...extra });
const blob = (name, extra = {}) => ({ name, size: 1000, etag: '"v1"', ...extra });
const inventory = (...blobs) => ({ containerUrl: base, blobs });
const catalog = (...episodes) => ({ episodes, transcripts: [] });
const synthetic = [{ start: 0, end: 60, text: "Synthetic complete episode passage." }];
async function fixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "bbpc-backfill-test-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("recording URL and ID3 number plus title recover mismatched dates", () => {
  const c = catalog(episode("one", 1, "2026-01-02", "The First", { recording: `${base}/20260101.mp3?signature=ignored` }), episode("two", 2, "2026-01-09", "The Second!"));
  const rows = matchBlobs(c, inventory(blob("20260101.mp3"), blob("20260108.mp3", { tags: { number: 2, title: "The Second" } })));
  assert.deepEqual(rows.map((r) => [r.episodeId, r.method]), [["one", "recording-url"], ["two", "id3-number-and-title"]]);
});

test("ambiguous numbers, dates, title disagreement and pre-shows stay unresolved", () => {
  const c = catalog(episode("one", 1, "2026-01-02", "Same"), episode("two", 1, "2026-01-02", "Same"), episode("three", 3, "2026-01-03"));
  const rows = matchBlobs(c, inventory(
    blob("bad.mp3", { tags: { number: 1, title: "Same" } }), blob("20260102.mp3"),
    blob("20260103.mp3", { tags: { number: 4, title: "Disagrees" } }),
    blob("20260103-Pre.mp3", { tags: { number: 3, title: "Title 3 Pre Show" } }),
  ));
  assert.ok(rows.every((r) => r.episodeId === null));
  assert.equal(rows[3].candidates[0].episodeId, "three");
  assert.equal(rows[3].reviewReason, "title-mismatch");
});

test("multiple audio objects cannot silently map to one episode; explicit review resolves it", () => {
  const c = catalog(episode("one", 1, "2026-01-02"));
  const i = inventory(blob("20260101.mp3", { tags: { number: 1, title: "Title 1" } }), blob("20260102.mp3"));
  assert.ok(matchBlobs(c, i).every((r) => r.episodeId === null));
  const rows = matchBlobs(c, i, [], [{ file: "20260102.json", episodeId: "one", complete: true }]);
  assert.equal(rows[0].episodeId, null);
  assert.equal(rows[1].episodeId, "one");
  assert.throws(() => matchBlobs(c, i, [{ blob: "absent.mp3", episodeId: "one" }]), /missing/);
  assert.throws(() => matchBlobs(c, i, [{ blob: "20260101.mp3", episodeId: "missing" }]), /missing/);
  assert.throws(() => matchBlobs(c, i, [{ blob: "20260101.mp3", episodeId: "one" }, { blob: "20260102.mp3", episodeId: "one" }]), /duplicate/);
});

test("invalid date names and absent catalog rows still become transcription jobs", async () => fixture(async (dir) => {
  const p = await buildPlan({ url, catalog: catalog(), inventory: inventory(blob("20261135.mp3"), blob("folder/special.mp3")), transcripts: dir });
  assert.equal(p.rows.length, 2);
  assert.ok(p.rows.every((r) => r.action === "transcribe" && r.episodeId === null));
  assert.notEqual(p.rows[0].key, p.rows[1].key);
  const changed = matchBlobs(catalog(), inventory(blob("20261135.mp3", { etag: '"v2"' })))[0];
  assert.notEqual(changed.key, p.rows[0].key);
}));

test("existing JSON alone never proves completion, and imported content is skipped", async () => fixture(async (dir) => {
  await writeFile(path.join(dir, "20260101.json"), JSON.stringify(synthetic));
  await writeFile(path.join(dir, "20260102.json"), "broken");
  const c = catalog(episode("one", 1, "2026-01-01"), episode("two", 2, "2026-01-02"), episode("three", 3, "2026-01-03"));
  c.transcripts = [{ episodeId: "three", hash: "already-imported" }];
  const args = { url, catalog: c, inventory: inventory(blob("20260101.mp3"), blob("20260102.mp3"), blob("20260103.mp3")), transcripts: dir };
  const p = await buildPlan(args);
  assert.deepEqual(p.rows.map((r) => [r.action, r.localStatus]), [["transcribe", "unconfirmed"], ["transcribe", "invalid"], ["skip-imported", "missing"]]);
  const approved = await buildPlan({ ...args, known: [{ file: "20260101.json", episodeId: "one", complete: true }] });
  assert.equal(approved.rows[0].action, "stage-existing");
  await assert.rejects(buildPlan({ ...args, known: [{ file: "20260101.json", episodeId: "one", complete: false }] }), /complete:true/);
}));

test("execution keeps unmapped completions separate, resumes completed jobs, and produces importer-ready mappings", async () => fixture(async (dir) => {
  const source = path.join(dir, "source"); await mkdir(source);
  const p = await buildPlan({ url, catalog: catalog(episode("one", 1, "2026-01-01")), inventory: inventory(blob("special.mp3"), blob("20260101.mp3")), transcripts: source });
  let calls = 0;
  const worker = async (_python, request) => { calls++; await writeFile(path.join(request.work, "candidate.json"), JSON.stringify(synthetic)); return { complete: true }; };
  const options = { output: path.join(dir, "output"), limit: 1, worker };
  assert.deepEqual(await executePlan(p, { ...options, matchedOnly: true }), { attempted: 1, completed: 1, ready: 1, failures: 0 });
  assert.deepEqual(await executePlan(p, options), { attempted: 1, completed: 2, ready: 1, failures: 0 });
  assert.deepEqual(await executePlan(p, options), { attempted: 0, completed: 2, ready: 1, failures: 0 });
  assert.equal(calls, 2);
  const mapping = JSON.parse(await readFile(path.join(options.output, "mapping.json"), "utf8"));
  assert.equal((await prepareImports(path.join(options.output, "ready"), mapping)).length, 1);
  assert.equal((await readdir(path.join(options.output, "unmapped"))).length, 1);
  await writeFile(path.join(options.output, "ready", mapping[0].file), "[]");
  assert.equal((await executePlan(p, options)).failures, 1);
  assert.equal(calls, 2, "tampered completed work must not be silently replaced");
}));

test("worker failures and invalid completions never become ready transcripts", async () => fixture(async (dir) => {
  const p = await buildPlan({ url, catalog: catalog(episode("one", 1, "2026-01-01")), inventory: inventory(blob("20260101.mp3")), transcripts: dir });
  for (const failure of ["throws", "partial", "invalid"]) {
    const output = path.join(dir, failure);
    const worker = async (_python, request) => {
      if (failure === "throws") throw new Error("Synthetic transcription failure");
      await writeFile(path.join(request.work, "candidate.json"), JSON.stringify(failure === "invalid" ? [{ start: -1, end: 1, text: "bad" }] : synthetic));
      return { complete: failure !== "partial" };
    };
    assert.equal((await executePlan(p, { output, limit: 1, worker })).failures, 1);
    assert.deepEqual(await readdir(path.join(output, "ready")), []);
    assert.deepEqual(JSON.parse(await readFile(path.join(output, "mapping.json"))), []);
  }
}));

test("invalid paths, changed plans, existing files and unapproved targets fail closed", async () => fixture(async (dir) => {
  const p = await buildPlan({ url, catalog: catalog(), inventory: inventory(blob("one.mp3")), transcripts: dir });
  await assert.rejects(executePlan({ ...p, rows: [{ ...p.rows[0], key: "../escape" }] }, { output: dir, limit: 1 }), /Invalid/);
  await assert.rejects(executePlan(p, { output: dir, limit: 0 }), /positive integer/);
  await writeFile(path.join(dir, "preserve.txt"), "existing data");
  await assert.rejects(executePlan(p, { output: dir, limit: 1 }), /empty output/);
  const output = path.join(dir, "different");
  await mkdir(output); await writeFile(path.join(output, "plan-id.txt"), "other");
  await assert.rejects(executePlan(p, { output, limit: 1 }), /different plan/);
  await assert.rejects(main(["plan", "--url", url, "--python", "unused", "--env-file", "unused", "--transcripts", dir, "--output", "unused"], {}), /BBPC_EXPECTED_CONVEX_URL/);
}));

test("catalog reader paginates and calls inspect with episodeId only", async () => {
  let pageCalls = 0; const inspected = [];
  const client = { query: async (_ref, args) => {
    if (args.paginationOpts) {
      assert.ok(args.paginationOpts.numItems <= 50);
      pageCalls++;
      return { page: [episode(String(pageCalls), pageCalls, "2026-01-01")], isDone: pageCalls === 2, continueCursor: "next" };
    }
    inspected.push(args); return { hash: "hash" };
  } };
  const result = await readCatalog(client);
  assert.equal(result.episodes.length, 2);
  assert.deepEqual(inspected, [{ episodeId: "1" }, { episodeId: "2" }]);
});

test("Python worker handles generator failures and completion without external dependencies", () => {
  execFileSync(process.env.BBPC_TRANSCRIPT_PYTHON || "python3", [fileURLToPath(new URL("./backfill-worker.test.py", import.meta.url))], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: "pipe",
  });
});
