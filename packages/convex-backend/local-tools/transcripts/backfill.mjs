import { readFile, writeFile, mkdir, readdir, stat, copyFile, unlink, rename, link } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../contracts/generated/convexApi.js";
import { assertImportTarget, prepareImports, requirePipelineToken } from "./import.mjs";
import { recordingDate, writeMapping } from "./map.mjs";

const workerPath = fileURLToPath(new URL("./backfill-worker.py", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = async (file, value) => {
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
};
const normalizeTitle = (value) => (value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const blobUrl = (base, name) => `${base}/${name.split("/").map(encodeURIComponent).join("/")}`;
const keyFor = (base, blob) => digest(`${blobUrl(base, blob.name)}\n${blob.etag}`);

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${decodeURIComponent(url.pathname)}`;
  } catch { return null; }
}

async function queryWithRetry(client, ref, args) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await client.query(ref, args); }
    catch (error) {
      if (error?.data || attempt === 2) throw error;
      await setTimeout(250 * 2 ** attempt);
    }
  }
}

/** Snapshot through existing read-only APIs, including authoritative transcript presence. */
export async function readCatalog(client) {
  const episodes = [];
  const cursors = new Set();
  let cursor = null;
  for (;;) {
    const page = await queryWithRetry(client, api.episodes.public.listPage, {
      paginationOpts: { cursor, numItems: 50 },
    });
    for (const e of page.page) {
      episodes.push({ id: e.id, number: e.number, title: e.title, date: e.date, recording: e.recording, status: e.status });
    }
    if (episodes.length > 10000) throw new Error("Catalog exceeds 10,000 episodes.");
    if (page.isDone) break;
    if (!page.continueCursor || cursors.has(page.continueCursor)) throw new Error("Catalog pagination did not advance.");
    cursor = page.continueCursor;
    cursors.add(cursor);
  }
  console.error(`Read ${episodes.length} catalog episodes; inspecting transcript presence...`);
  const transcripts = [];
  // Bound concurrent reads and keep all metadata text-free except episode titles.
  for (let i = 0; i < episodes.length; i += 4) {
    const batch = await Promise.all(episodes.slice(i, i + 4).map(async (e) => {
      const result = await queryWithRetry(client, api.episodes.transcripts.inspect, { episodeId: e.id });
      return { episodeId: e.id, hash: result.hash };
    }));
    transcripts.push(...batch);
    if ((i + 4) % 100 === 0) console.error(`Inspected ${i + 4}/${episodes.length} episodes`);
  }
  return { episodes, transcripts };
}

/** Run a JSON worker; never invoke pipeline.py or any publisher. */
export function runWorker(python, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [workerPath], { stdio: ["pipe", "pipe", "inherit"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.stdin.on("error", () => { /* A failed startup can close stdin before delivery. */ });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Backfill worker exited ${code ?? "after interruption"}.`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error("Invalid worker result.")); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Match strong identity evidence first; dates and episode numbers are not unique IDs. */
export function matchBlobs(catalog, inventory, overrides = [], known = []) {
  const ids = new Map(catalog.episodes.map((e) => [e.id, e]));
  if (ids.size !== catalog.episodes.length) throw new Error("Duplicate catalog IDs.");
  const blobs = inventory.blobs;
  const names = new Set(blobs.map((b) => b.name));
  if (names.size !== blobs.length) throw new Error("Duplicate audio object names.");
  const explicit = new Map();
  for (const entry of known) {
    if (entry.complete !== true || path.basename(entry.file) !== entry.file || !entry.file.endsWith(".json"))
      throw new Error("Known mapping must be an approved complete:true import mapping.");
    const matches = blobs.filter((b) => `${path.posix.basename(b.name, path.posix.extname(b.name))}.json` === entry.file);
    if (matches.length !== 1) throw new Error(`Known file ${entry.file} does not identify one audio object.`);
    if (explicit.has(matches[0].name)) throw new Error("Duplicate known mapping.");
    explicit.set(matches[0].name, { episodeId: entry.episodeId, method: "approved-mapping", approvedFile: entry.file });
  }
  const overrideNames = new Set();
  for (const entry of overrides) {
    if (!names.has(entry.blob) || overrideNames.has(entry.blob)) throw new Error("Override has missing or duplicate audio object.");
    overrideNames.add(entry.blob);
    explicit.set(entry.blob, { episodeId: entry.episodeId, method: "override" });
  }
  const explicitIds = new Set();
  for (const entry of explicit.values()) {
    if (!ids.has(entry.episodeId) || explicitIds.has(entry.episodeId)) throw new Error("Explicit mapping has missing or duplicate episode ID.");
    explicitIds.add(entry.episodeId);
  }
  const rows = blobs.map((blob) => {
    let candidates = [];
    let method = "unresolved";
    let approvedFile;
    if (explicit.has(blob.name)) {
      const entry = explicit.get(blob.name);
      candidates = [ids.get(entry.episodeId)]; method = entry.method; approvedFile = entry.approvedFile;
    } else {
      candidates = catalog.episodes.filter((e) => normalizedUrl(e.recording) === normalizedUrl(blobUrl(inventory.containerUrl, blob.name)));
      if (candidates.length) method = "recording-url";
      else if (Number.isSafeInteger(blob.tags?.number) && normalizeTitle(blob.tags?.title)) {
        candidates = catalog.episodes.filter((e) => e.number === blob.tags.number && normalizeTitle(e.title) === normalizeTitle(blob.tags.title));
        if (candidates.length) method = "id3-number-and-title";
      }
      if (!candidates.length) {
        let date;
        try { date = recordingDate(`${path.posix.basename(blob.name, path.posix.extname(blob.name))}.json`); } catch { /* Non-date and malformed names still get transcribed. */ }
        candidates = date ? catalog.episodes.filter((e) => e.date === date) : [];
        method = candidates.length ? "exact-date" : "unresolved";
        if (candidates.length === 1 && Number.isSafeInteger(blob.tags?.number)
          && (candidates[0].number !== blob.tags.number || (normalizeTitle(blob.tags?.title)
            && normalizeTitle(candidates[0].title) !== normalizeTitle(blob.tags.title))))
          method = "date-conflicts-with-id3";
      }
    }
    let reviewReason = null;
    if (method === "unresolved") {
      candidates = catalog.episodes.filter((e) => e.number === blob.tags?.number);
      reviewReason = candidates.length ? "title-mismatch" : Number.isSafeInteger(blob.tags?.number) ? "number-not-in-catalog" : "missing-id3-number";
    }
    const episode = candidates.length === 1 && !["unresolved", "date-conflicts-with-id3"].includes(method) ? candidates[0] : null;
    if (!episode && !reviewReason) reviewReason = method === "date-conflicts-with-id3" ? method : "ambiguous-catalog-match";
    return {
      key: keyFor(inventory.containerUrl, blob), blob, episodeId: episode?.id ?? null,
      number: episode?.number ?? null, title: episode?.title ?? null, method, approvedFile, reviewReason,
      candidates: candidates.map((e) => ({ episodeId: e.id, number: e.number, title: e.title, date: e.date })),
    };
  });
  // A pre-show, alternate edit, or duplicated catalog row must not silently share a mapping.
  const assigned = new Map();
  for (const row of rows) {
    if (!row.episodeId) continue;
    assigned.set(row.episodeId, [...(assigned.get(row.episodeId) ?? []), row]);
  }
  for (const group of assigned.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      if (["approved-mapping", "override"].includes(row.method)) continue;
      row.episodeId = null; row.number = null; row.title = null; row.method = "multiple-audio-objects";
      row.reviewReason = "multiple-audio-objects";
    }
  }
  return rows;
}

/** Classify every MP3 independently of whether the episode catalog contains it. */
export async function buildPlan({ url, catalog, inventory, transcripts, overrides = [], known = [] }) {
  const rows = matchBlobs(catalog, inventory, overrides, known);
  const hashes = new Map(catalog.transcripts.map((e) => [e.episodeId, e.hash]));
  const files = new Set((await readdir(transcripts, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name));
  for (const row of rows) {
    const file = `${path.posix.basename(row.blob.name, path.posix.extname(row.blob.name))}.json`;
    row.localFile = path.join(path.resolve(transcripts), file);
    row.localStatus = "missing";
    if (files.has(file)) {
      try {
        const [prepared] = await prepareImports(row.localFile, [{ file, episodeId: row.episodeId ?? "unmapped", complete: true }]);
        row.localHash = prepared.hash;
        row.localStatus = row.approvedFile === file ? "approved" : "unconfirmed";
      } catch { row.localStatus = "invalid"; }
    }
    row.importedHash = hashes.get(row.episodeId) ?? null;
    row.action = row.importedHash ? "skip-imported" : row.localStatus === "approved" ? "stage-existing" : "transcribe";
  }
  const count = (field) => Object.fromEntries([...new Set(rows.map((r) => r[field]))].sort().map((value) => [value, rows.filter((r) => r[field] === value).length]));
  const mapped = new Set(rows.map((r) => r.episodeId).filter(Boolean));
  return {
    version: 1, createdAt: new Date().toISOString(), url, containerUrl: inventory.containerUrl,
    summary: { audioObjects: rows.length, catalogEpisodes: catalog.episodes.length, mapped: mapped.size,
      unresolved: rows.filter((r) => !r.episodeId).length, actions: count("action"), local: count("localStatus"), methods: count("method") },
    rows,
    catalogWithoutAudio: catalog.episodes.filter((e) => !mapped.has(e.id)).map((e) => ({ ...e, importedHash: hashes.get(e.id) ?? null })),
  };
}

function validatePlan(plan) {
  if (plan.version !== 1 || !Array.isArray(plan.rows) || plan.rows.length > 10000) throw new Error("Invalid backfill plan.");
  const base = new URL(plan.containerUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/episodes")
    throw new Error("Invalid Azure container URL.");
  const keys = new Set(); const ids = new Set();
  for (const row of plan.rows) {
    if (typeof row.blob?.name !== "string" || !row.blob.name.toLowerCase().endsWith(".mp3")
      || typeof row.blob.etag !== "string" || !row.blob.etag || !Number.isSafeInteger(row.blob.size) || row.blob.size <= 0
      || row.key !== keyFor(plan.containerUrl, row.blob) || keys.has(row.key)
      || !["transcribe", "stage-existing", "skip-imported"].includes(row.action)
      || (row.episodeId !== null && (typeof row.episodeId !== "string" || !row.episodeId || ids.has(row.episodeId))))
      throw new Error("Invalid or duplicate backfill row.");
    keys.add(row.key); if (row.episodeId) ids.add(row.episodeId);
  }
}

/** Generate locally. A completed receipt is created only after import validation succeeds. */
export async function executePlan(plan, { output, python, envFile, limit, matchedOnly = false, model = "large-v3-turbo", worker = runWorker }) {
  validatePlan(plan);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  output = path.resolve(output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const identity = digest(JSON.stringify(plan));
  const marker = path.join(output, "plan-id.txt");
  const existing = await readdir(output);
  if (existing.length && !existing.includes("plan-id.txt")) throw new Error("Choose an empty output directory.");
  try { await writeFile(marker, identity, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST" || await readFile(marker, "utf8") !== identity)
      throw new Error("Output belongs to a different plan; use a new output directory.");
  }
  // One writer per output: protects receipts, audio cache, and mapping publication.
  const lock = path.join(output, ".lock");
  await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  try {
    for (const name of ["work", "ready", "unmapped", "receipts"]) await mkdir(path.join(output, name), { recursive: true, mode: 0o700 });
    const mapping = []; const report = []; let attempted = 0; let failures = 0;
    for (const row of plan.rows) {
      if (row.action === "skip-imported" || (matchedOnly && !row.episodeId)) continue;
      const file = `${row.key}.json`;
      const destination = path.join(output, row.episodeId ? "ready" : "unmapped", file);
      const receiptFile = path.join(output, "receipts", file);
      try {
        let receipt;
        try { receipt = await json(receiptFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
        const entry = { file, episodeId: row.episodeId ?? "unmapped", complete: true };
        if (receipt) {
          const [prepared] = await prepareImports(destination, [entry]);
          if (receipt.key !== row.key || receipt.hash !== prepared.hash || receipt.episodeId !== row.episodeId || receipt.complete !== true)
            throw new Error("Completed output differs from receipt.");
        } else {
          if (attempted >= limit) continue;
          attempted++;
          console.error(`${attempted}/${limit}: ${row.blob.name} (${row.action}, ${row.method})`);
          const work = path.join(output, "work", row.key);
          await mkdir(work, { recursive: true, mode: 0o700 });
          const candidate = path.join(work, "candidate.json");
          let completion;
          if (row.action === "stage-existing") {
            const [current] = await prepareImports(row.localFile, [{ file: path.basename(row.localFile), episodeId: entry.episodeId, complete: true }]);
            if (row.localStatus !== "approved" || current.hash !== row.localHash) throw new Error("Approved source changed since plan.");
            await copyFile(row.localFile, `${candidate}.tmp`);
            await rename(`${candidate}.tmp`, candidate);
            completion = { complete: true, source: "approved-mapping" };
          } else {
            completion = await worker(python, { operation: "transcribe", envFile, containerUrl: plan.containerUrl, blob: row.blob, work, model });
            if (completion?.complete !== true) throw new Error("Worker did not confirm completion.");
          }
          const [prepared] = await prepareImports(candidate, [{ ...entry, file: "candidate.json" }]);
          // Atomically expose a complete file without replacing pre-existing output.
          // Candidate updates use rename, so subsequent attempts cannot alter this inode.
          try { await link(candidate, destination); }
          catch (error) {
            if (error.code !== "EEXIST" || digest(await readFile(candidate)) !== digest(await readFile(destination))) throw error;
          }
          receipt = { key: row.key, blob: row.blob.name, episodeId: row.episodeId, complete: true, hash: prepared.hash, completion };
          await save(receiptFile, receipt);
          // Keep only one full audio download while retaining partial failures for diagnosis.
          if (row.action === "transcribe") await unlink(path.join(work, "audio.mp3")).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
        if (row.episodeId) mapping.push(entry);
        report.push({ ...receipt, file: destination });
      } catch (error) {
        failures++;
        report.push({ key: row.key, blob: row.blob.name, status: "failed", error: error.message });
        console.error(`${row.blob.name}: ${error.message}`);
      }
    }
    await save(path.join(output, "mapping.json"), mapping);
    await save(path.join(output, "report.json"), report);
    return { attempted, completed: report.filter((r) => r.complete).length, ready: mapping.length, failures };
  } finally { await unlink(lock); }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    url: { type: "string" }, python: { type: "string" }, "env-file": { type: "string" },
    transcripts: { type: "string" }, "known-mapping": { type: "string" }, overrides: { type: "string" },
    output: { type: "string" }, plan: { type: "string" }, "read-tags": { type: "boolean" }, "matched-only": { type: "boolean" },
    limit: { type: "string", default: "1" }, model: { type: "string", default: "large-v3-turbo" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("transcripts:backfill plan --url ORIGIN --python VENV_PYTHON --env-file PIPELINE_ENV --transcripts DIRECTORY --output NEW_PLAN [--known-mapping APPROVED_MAPPING] [--overrides JSON] [--read-tags]\ntranscripts:backfill run --plan PLAN --python VENV_PYTHON --env-file PIPELINE_ENV --output DIRECTORY [--limit 1] [--matched-only] [--model large-v3-turbo]\nPlan is read-only. Run creates local transcripts only; no catalog writes, publication, clips, or episode creation. Both require the importer's expected-target settings; plan also requires a pipeline JWT.");
    return;
  }
  if (positionals.length !== 1 || !["plan", "run"].includes(positionals[0]) || !values.python || !values["env-file"] || !values.output)
    throw new Error("Specify plan or run, --python, --env-file, and --output. See --help.");
  if (positionals[0] === "plan") {
    if (!values.url || !values.transcripts) throw new Error("Plan requires --url and --transcripts.");
    const url = assertImportTarget(values.url, env);
    const client = new ConvexHttpClient(url, { logger: false });
    client.setAuth(requirePipelineToken(env));
    try { await stat(values.output); throw new Error("Plan output already exists."); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const catalog = await readCatalog(client);
    console.error("Reading Azure inventory and optional ID3 tags...");
    const inventory = await runWorker(values.python, { operation: "inventory", envFile: values["env-file"], readTags: values["read-tags"] });
    const plan = await buildPlan({ url, catalog, inventory, transcripts: values.transcripts,
      known: values["known-mapping"] ? await json(values["known-mapping"]) : [], overrides: values.overrides ? await json(values.overrides) : [] });
    validatePlan(plan);
    await writeMapping(values.output, plan);
    console.log(JSON.stringify(plan.summary, null, 2));
  } else {
    if (!values.plan) throw new Error("Run requires --plan.");
    const plan = await json(values.plan);
    assertImportTarget(plan.url, env);
    const result = await executePlan(plan, { output: values.output, python: values.python, envFile: values["env-file"], limit: Number(values.limit), matchedOnly: values["matched-only"], model: values.model });
    console.log(JSON.stringify(result));
    if (result.failures) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.data ? "Backfill read failed; check pipeline authentication and target." : error.message);
    process.exitCode = 1;
  });
}
