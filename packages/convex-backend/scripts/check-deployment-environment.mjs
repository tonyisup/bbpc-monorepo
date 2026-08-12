import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const convexExecutable = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);
const requiredEnvironmentNames = [
  "BBPC_API_VERSION",
  "BBPC_ENVIRONMENT",
  "CLERK_JWT_ISSUER_DOMAIN",
  "CLERK_M2M_AUDIENCE",
  "TMDB_API_KEY",
];
const allowedEnvironments = new Set(["production", "staging"]);

export function parseEnvironmentNames(output) {
  return new Set(
    output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z][A-Z0-9_]*$/u.test(line)),
  );
}

export function assertRequiredEnvironmentNames(
  presentNames,
  requiredNames = requiredEnvironmentNames,
) {
  const missingNames = requiredNames.filter(
    (name) => !presentNames.has(name),
  );
  if (missingNames.length > 0) {
    throw new Error(
      `Missing required Convex environment variables: ${missingNames.join(", ")}.`,
    );
  }
}

export function assertExpectedEnvironmentValue({
  name,
  actualValue,
  expectedValue,
}) {
  if (actualValue.trim() !== expectedValue) {
    throw new Error(`${name} does not match the expected deployment value.`);
  }
}

export function assertSupportedEnvironment(expectedEnvironment) {
  if (!allowedEnvironments.has(expectedEnvironment)) {
    throw new Error(
      "BBPC_EXPECTED_ENVIRONMENT must be exactly staging or production.",
    );
  }
}

function runConvex(args, env) {
  return execFileSync(convexExecutable, args, {
    cwd: root,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function main(env = process.env) {
  const expectedEnvironment = env.BBPC_EXPECTED_ENVIRONMENT;
  assertSupportedEnvironment(expectedEnvironment);

  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const presentNames = parseEnvironmentNames(
    runConvex(["env", "list", "--names-only"], env),
  );
  assertRequiredEnvironmentNames(presentNames);
  assertExpectedEnvironmentValue({
    name: "BBPC_ENVIRONMENT",
    actualValue: runConvex(["env", "get", "BBPC_ENVIRONMENT"], env),
    expectedValue: expectedEnvironment,
  });
  assertExpectedEnvironmentValue({
    name: "BBPC_API_VERSION",
    actualValue: runConvex(["env", "get", "BBPC_API_VERSION"], env),
    expectedValue: packageJson.version,
  });

  process.stdout.write(
    `Convex deployment environment passed. requiredNames=${requiredEnvironmentNames.length} environment=${expectedEnvironment} apiVersion=${packageJson.version}\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  try {
    main();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown deployment-environment error.";
    process.stderr.write(
      `Convex deployment environment failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}
