import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { assertImportTarget, requirePipelineToken, prepareImports, importPrepared } from "./import.mjs";
import { createMapping } from "./map.mjs";

/** Validate locally, then resolve a single recording to its canonical episode. */
export async function preparePipelineImport(client, { source, recordingFile, episodeId }) {
  if (!(await stat(source)).isFile()) throw new Error("Pipeline imports require one transcript file.");
  if (episodeId !== undefined && !episodeId.trim()) throw new Error("--episode-id must be nonempty.");
  // Validate before querying. The placeholder never leaves this process.
  const prepared = await prepareImports(source, [{
    file: path.basename(source), episodeId: episodeId?.trim() || "pending-episode-lookup", complete: true,
  }]);
  if (!episodeId) {
    if (!recordingFile) throw new Error("--recording-file or --episode-id is required.");
    // Use the audio filename, even when --transcript overrides the JSON filename.
    const file = `${path.parse(recordingFile).name}.json`;
    try {
      const mapping = await createMapping(client, [file], { complete: true });
      prepared[0].episodeId = mapping[0].episodeId;
    } catch (error) {
      throw new Error(`${error.message} Supply --episode-id after verifying the correct catalog episode.`);
    }
  }
  return prepared;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args: argv, options: {
    source: { type: "string" }, "recording-file": { type: "string" },
    "episode-id": { type: "string" }, url: { type: "string" },
    "confirm-complete": { type: "boolean", default: false },
    "check-config": { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  } });
  if (!values.url) throw new Error("--url is required.");
  const url = assertImportTarget(values.url, env);
  if (values["check-config"]) {
    console.log(`Transcript import target verified: ${url}`);
    return;
  }
  if (!values.source || !values["confirm-complete"])
    throw new Error("--source and explicit --confirm-complete are required.");
  const token = requirePipelineToken(env);
  const client = new ConvexHttpClient(url, { logger: false });
  client.setAuth(token);
  const prepared = await preparePipelineImport(client, {
    source: values.source, recordingFile: values["recording-file"], episodeId: values["episode-id"],
  });
  await importPrepared(client, prepared, { apply: values.apply });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof Error && !error.data ? error.message : "Pipeline transcript import failed.");
    process.exitCode = 1;
  });
}
