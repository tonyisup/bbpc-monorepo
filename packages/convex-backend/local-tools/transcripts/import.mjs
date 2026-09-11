import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { setTimeout } from "node:timers";
import { URL, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../contracts/generated/convexApi.js";
import { BBPC_API_VERSION } from "../../contracts/index.js";
import {
  buildPassages,
  transcriptFingerprintInput,
} from "../../convex/lib/transcriptModel.ts";

/** Read and locally validate the pipeline JWT used by transcript tooling. */
export function requirePipelineToken(env) {
  const token = env.BBPC_PIPELINE_ACCESS_TOKEN?.trim();
  if (!token)
    throw new Error("BBPC_PIPELINE_ACCESS_TOKEN is required. Supply a short-lived Clerk M2M JWT for the pipeline.");
  // Catch credential mix-ups; Convex still verifies signature, issuer and audience.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    throw new Error("BBPC_PIPELINE_ACCESS_TOKEN must be a Clerk M2M JWT (three dot-separated parts), not a Convex deploy key or Clerk machine secret. Mint a JWT using the pipeline's Clerk M2M workflow; pass the token without a Bearer prefix.");
  return token;
}

/** Require an explicitly approved Convex origin before any remote operation. */
export function assertImportTarget(url, env) {
  const target = new URL(url);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
  if (
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/" ||
    (target.protocol !== "https:" && !(local && target.protocol === "http:"))
  ) {
    throw new Error("Use an HTTPS Convex origin or explicit localhost origin.");
  }
  if (
    !env.BBPC_EXPECTED_CONVEX_URL ||
    new URL(env.BBPC_EXPECTED_CONVEX_URL).origin !== target.origin
  ) {
    throw new Error("Target must match BBPC_EXPECTED_CONVEX_URL.");
  }
  if (
    env.BBPC_FORBIDDEN_CONVEX_DEPLOYMENT &&
    target.hostname === `${env.BBPC_FORBIDDEN_CONVEX_DEPLOYMENT}.convex.cloud`
  ) {
    throw new Error("Target is the explicitly forbidden Convex deployment.");
  }
  if (
    !local &&
    (!env.BBPC_EXPECTED_CONVEX_DEPLOYMENT ||
      target.hostname !== `${env.BBPC_EXPECTED_CONVEX_DEPLOYMENT}.convex.cloud`)
  ) {
    throw new Error(
      "Remote target must match BBPC_EXPECTED_CONVEX_DEPLOYMENT."
    );
  }
  return target.origin;
}

/** Validate transcript files and build deterministic import requests. */
export async function prepareImports(source, manifest) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 1000) {
    throw new Error(
      "Mapping must contain 1–1000 {file, episodeId, complete:true} entries."
    );
  }
  const sourcePath = path.resolve(source);
  const sourceStat = await stat(sourcePath);
  const directory = sourceStat.isDirectory()
    ? sourcePath
    : path.dirname(sourcePath);
  const files = sourceStat.isDirectory()
    ? (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort()
    : [path.basename(sourcePath)];
  if (!files.length) throw new Error("No transcript JSON files found.");
  const mappings = new Map();
  const ids = new Set();
  for (const entry of manifest) {
    if (
      !entry ||
      typeof entry.file !== "string" ||
      path.basename(entry.file) !== entry.file ||
      typeof entry.episodeId !== "string" ||
      !entry.episodeId.trim() ||
      mappings.has(entry.file) ||
      ids.has(entry.episodeId)
    ) {
      throw new Error(
        "Each mapping needs a unique filename and unique nonempty episodeId."
      );
    }
    if (entry.complete !== true) {
      throw new Error(
        `${entry.file}: transcription completion is unconfirmed. After verifying transcription finished, set explicit complete:true in the mapping or regenerate it with transcripts:map --confirm-complete.`
      );
    }
    mappings.set(entry.file, entry);
    ids.add(entry.episodeId);
  }
  const prepared = [];
  for (const file of files) {
    const entry = mappings.get(file);
    if (!entry)
      throw new Error(`No explicit completed-episode mapping for ${file}.`);
    const filename = path.join(directory, file);
    if ((await stat(filename)).size > 8 * 1024 * 1024)
      throw new Error(`${file}: input exceeds 8 MiB.`);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filename, "utf8"));
    } catch {
      throw new Error(`${file}: invalid transcript JSON.`);
    }
    let built;
    try {
      built = buildPassages(parsed);
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
    const hash = createHash("sha256")
      .update(transcriptFingerprintInput(built.passages))
      .digest("hex");
    prepared.push({
      file,
      episodeId: entry.episodeId,
      complete: true,
      hash,
      ...built,
    });
  }
  return prepared;
}

/** Report or apply prepared transcript replacements with bounded retries. */
export async function importPrepared(
  client,
  prepared,
  { apply = false, report = console.log } = {}
) {
  // Inspect every ID before the first write, so mapping failures never start a batch.
  const inspected = [];
  for (const item of prepared) {
    const current = await client.query(api.episodes.transcripts.inspect, {
      episodeId: item.episodeId,
    });
    inspected.push({ item, current });
  }
  for (const { item, current } of inspected) {
    report(
      JSON.stringify({
        file: item.file,
        episodeId: item.episodeId,
        episodeNumber: current.number,
        segmentCount: item.segmentCount,
        passageCount: item.passages.length,
        complete: true,
        action:
          current.hash === item.hash
            ? "unchanged"
            : apply
            ? "replace"
            : "would-replace",
      })
    );
    if (!apply || current.hash === item.hash) continue;
    let result;
    // Repeat exactly the same CAS request after transport failure, never refresh the expected hash.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await client.mutation(api.episodes.transcripts.replace, {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: item.episodeId,
          expectedHash: current.hash,
          complete: true,
          passages: item.passages,
        });
        break;
      } catch (error) {
        if (error?.data || attempt === 2)
          throw new Error(
            `${item.file}: import failed; rerun dry-run to inspect current state.`
          );
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1))
        );
      }
    }
    if (
      result?.hash !== item.hash ||
      result?.passageCount !== item.passages.length
    ) {
      throw new Error(
        `${item.file}: import response did not match the validated transcript.`
      );
    }
  }
}

/** Run the transcript validation and import command-line workflow. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      mapping: { type: "string" },
      url: { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: pnpm --filter @tonyisup/bbpc-convex-api transcripts:import --source <file-or-dir> --mapping <mapping.json> [--url <origin>] [--apply]\nDry-run is default. Without --url, validates files offline. --apply requires --url and a pipeline JWT in BBPC_PIPELINE_ACCESS_TOKEN."
    );
    return;
  }
  if (!values.source || !values.mapping)
    throw new Error("--source and --mapping are required.");
  const prepared = await prepareImports(
    values.source,
    JSON.parse(await readFile(values.mapping, "utf8"))
  );
  if (!values.url) {
    if (values.apply) throw new Error("--apply requires an explicit --url.");
    for (const { file, episodeId, segmentCount, passages } of prepared) {
      console.log(
        JSON.stringify({
          file,
          episodeId,
          segmentCount,
          passageCount: passages.length,
          complete: true,
          action: "validated-offline",
          episodeVerified: false,
        })
      );
    }
    return;
  }
  const url = assertImportTarget(values.url, env);
  const token = requirePipelineToken(env);
  const client = new ConvexHttpClient(url, { logger: false });
  client.setAuth(token);
  await importPrepared(client, prepared, { apply: values.apply });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    // Never print server responses, tokens, or transcript contents.
    console.error(
      error instanceof Error && !error.data
        ? error.message
        : "Transcript import failed."
    );
    process.exitCode = 1;
  });
}
