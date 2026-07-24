import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { verifyDomainManifest } from "./manifest.mjs";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolDirectory, "../..");
const REQUIRED_SOURCE_ACK =
  "--ack-production-derived-local-only";
const REQUIRED_REPLACE_ACK =
  "--ack-replace-local-raw-staging";

function usage() {
  return [
    "Usage:",
    "  npm run migration:stage:local -- --run-id <id> " +
      "--domain <identity|catalog|episodes> " +
      `${REQUIRED_SOURCE_ACK} ${REQUIRED_REPLACE_ACK}`,
    "",
    "Imports only to the explicit Convex local deployment.",
  ].join("\n");
}

function parseArguments(argv) {
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const runIndex = argv.indexOf("--run-id");
  const domainIndex = argv.indexOf("--domain");
  const runId = runIndex < 0 ? undefined : argv[runIndex + 1];
  const domain =
    domainIndex < 0 ? undefined : argv[domainIndex + 1];
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
  ) {
    throw new Error("A safe --run-id is required");
  }
  if (
    domain !== "identity" &&
    domain !== "catalog" &&
    domain !== "episodes"
  ) {
    throw new Error(
      "--domain must be identity, catalog, or episodes",
    );
  }
  if (!argv.includes(REQUIRED_SOURCE_ACK)) {
    throw new Error(
      `Explicit ${REQUIRED_SOURCE_ACK} acknowledgement is required`,
    );
  }
  if (!argv.includes(REQUIRED_REPLACE_ACK)) {
    throw new Error(
      `Explicit ${REQUIRED_REPLACE_ACK} acknowledgement is required`,
    );
  }
  return { runId, domain };
}

const { runId, domain } = parseArguments(process.argv.slice(2));
const verified = verifyDomainManifest({
  projectRoot,
  runId,
  domain,
});

process.stdout.write(
  [
    "Verified immutable local migration manifest.",
    `runId=${runId}`,
    `domain=${domain}`,
    ...verified.files.map(
      (file) =>
        `${file.table}.rows=${file.rowCount} sha256=${file.sha256}`,
    ),
    "",
  ].join("\n"),
);

for (const file of verified.files) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    command,
    [
      "convex",
      "import",
      "--deployment",
      "local",
      "--table",
      file.table,
      "--format",
      "jsonLines",
      "--replace",
      "--yes",
      file.filePath,
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(
      `Unable to execute local import for ${file.table}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Local import failed for ${file.table}; rerun after resolving the reported error`,
    );
  }
}

process.stdout.write(
  `Local raw staging import complete for ${domain}.\n`,
);
