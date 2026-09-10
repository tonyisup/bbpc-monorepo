import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../contracts/generated/convexApi.js";
import { assertImportTarget, requirePipelineToken } from "./import.mjs";

export function recordingDate(file) {
  const match = /^(\d{4})(\d{2})(\d{2})\.json$/.exec(file);
  if (!match) throw new Error(`${file}: expected a YYYYMMDD.json filename.`);
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error(`${file}: invalid recording date.`);
  return date;
}

export async function transcriptFiles(source) {
  const sourcePath = path.resolve(source);
  const info = await stat(sourcePath);
  if (!info.isDirectory() && !info.isFile())
    throw new Error("--source must be a transcript file or directory.");
  const files = info.isDirectory()
    ? (await readdir(sourcePath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name).sort()
    : [path.basename(sourcePath)];
  if (!files.length || files.length > 1000)
    throw new Error("Source must contain 1–1000 transcript JSON files.");
  // Validate the entire source before making any backend requests.
  files.forEach(recordingDate);
  return files;
}

export async function createMapping(client, files, { complete = false } = {}) {
  if (!files.length || files.length > 1000 || new Set(files).size !== files.length)
    throw new Error("Expected 1–1000 unique transcript filenames.");
  const datedFiles = files.map((file) => ({ file, date: recordingDate(file) }));
  const mapping = [];
  const ids = new Set();
  for (const { file, date } of datedFiles) {
    let episode;
    try {
      episode = await client.query(api.pipeline.content.getEpisodeByDate, { date });
    } catch (error) {
      const conflict = error?.data?.code === "CONFLICT";
      throw new Error(conflict
        ? `${file}: multiple episodes have recording date ${date}; resolve the duplicate first.`
        : `${file}: episode lookup failed for ${date}; check pipeline authentication, target, and duplicate recording dates.`);
    }
    if (episode === null)
      throw new Error(`${file}: no episode has recording date ${date}.`);
    if (!episode || typeof episode.id !== "string" || !episode.id.trim() || episode.date !== date)
      throw new Error(`${file}: episode lookup returned an invalid ID or mismatched recording date.`);
    if (ids.has(episode.id))
      throw new Error(`${file}: episode is already mapped to another transcript.`);
    ids.add(episode.id);
    mapping.push({ file, episodeId: episode.id, complete: complete === true });
  }
  return mapping;
}

export async function writeMapping(output, mapping) {
  // Exclusive creation prevents replacing an existing operator-reviewed mapping.
  await writeFile(path.resolve(output), `${JSON.stringify(mapping, null, 2)}\n`, {
    flag: "wx", mode: 0o600,
  });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      output: { type: "string" },
      url: { type: "string" },
      "confirm-complete": { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log("Usage: pnpm --filter @tonyisup/bbpc-convex-api transcripts:map --source <YYYYMMDD.json-or-dir> --output <new-mapping.json> --url <origin> [--confirm-complete]\nRead-only exact recording-date lookup. Requires BBPC_PIPELINE_ACCESS_TOKEN and the importer's expected-target environment settings. Defaults to complete:false; use --confirm-complete only after verifying every transcript finished. Existing output files are never overwritten.");
    return;
  }
  if (!values.source || !values.output || !values.url)
    throw new Error("--source, --output, and --url are required.");
  const url = assertImportTarget(values.url, env);
  const token = requirePipelineToken(env);
  const files = await transcriptFiles(values.source);
  const client = new ConvexHttpClient(url, { logger: false });
  client.setAuth(token);
  const mapping = await createMapping(client, files, { complete: values["confirm-complete"] });
  // No mapping is written unless every date resolves unambiguously.
  await writeMapping(values.output, mapping);
  console.log(`Created ${path.resolve(values.output)} with ${mapping.length} episode mapping(s).`);
  if (!values["confirm-complete"])
    console.log("Completion is unconfirmed (complete:false). Verify transcription finished before importing.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error && !error.data ? error.message : "Transcript mapping failed.");
    process.exitCode = 1;
  });
}
