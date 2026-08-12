import process from "node:process";
import { pathToFileURL } from "node:url";

const DEPLOYMENT_NAME_PATTERN = /^[a-z][a-z0-9-]*-[0-9]+$/u;
const DEPLOY_KEY_KIND_PATTERN = /^(?:dev|preview|prod)$/u;

export function parseDeployKeyTarget(deployKey) {
  if (typeof deployKey !== "string" || deployKey.length === 0) {
    throw new Error("CONVEX_DEPLOY_KEY is required.");
  }

  const separatorIndex = deployKey.indexOf("|");
  const header =
    separatorIndex === -1 ? deployKey : deployKey.slice(0, separatorIndex);
  const headerParts = header.split(":");
  if (
    headerParts.length !== 2 ||
    !DEPLOY_KEY_KIND_PATTERN.test(headerParts[0] ?? "") ||
    !DEPLOYMENT_NAME_PATTERN.test(headerParts[1] ?? "")
  ) {
    throw new Error("CONVEX_DEPLOY_KEY has an unsupported target header.");
  }

  return {
    kind: headerParts[0],
    deployment: headerParts[1],
  };
}

export function assertDeployTarget({
  deployKey,
  expectedDeployment,
  forbiddenDeployment,
}) {
  if (
    typeof expectedDeployment !== "string" ||
    !DEPLOYMENT_NAME_PATTERN.test(expectedDeployment)
  ) {
    throw new Error(
      "BBPC_EXPECTED_CONVEX_DEPLOYMENT must be a valid deployment name.",
    );
  }
  if (
    forbiddenDeployment !== undefined &&
    (typeof forbiddenDeployment !== "string" ||
      !DEPLOYMENT_NAME_PATTERN.test(forbiddenDeployment))
  ) {
    throw new Error(
      "BBPC_FORBIDDEN_CONVEX_DEPLOYMENT must be a valid deployment name.",
    );
  }
  if (expectedDeployment === forbiddenDeployment) {
    throw new Error(
      "Expected and forbidden Convex deployments must be different.",
    );
  }

  const target = parseDeployKeyTarget(deployKey);
  if (target.deployment !== expectedDeployment) {
    throw new Error(
      "CONVEX_DEPLOY_KEY does not target the expected Convex deployment.",
    );
  }
  if (
    forbiddenDeployment !== undefined &&
    target.deployment === forbiddenDeployment
  ) {
    throw new Error(
      "CONVEX_DEPLOY_KEY targets the explicitly forbidden deployment.",
    );
  }

  return target;
}

export function main(env = process.env) {
  const target = assertDeployTarget({
    deployKey: env.CONVEX_DEPLOY_KEY,
    expectedDeployment: env.BBPC_EXPECTED_CONVEX_DEPLOYMENT,
    forbiddenDeployment: env.BBPC_FORBIDDEN_CONVEX_DEPLOYMENT,
  });
  process.stdout.write(
    `Convex deploy target passed. deployment=${target.deployment}\n`,
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
      error instanceof Error ? error.message : "Unknown deploy-target error.";
    process.stderr.write(`Convex deploy target failed: ${message}\n`);
    process.exitCode = 1;
  }
}
