import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertDeployTarget } from "./check-deploy-target.mjs";

const root = path.resolve(import.meta.dirname, "..");
const commitPattern = /^[0-9a-f]{40}$/u;

export const productionDeployment = "determined-wombat-872";
export const stagingDeployment = "merry-shepherd-928";
export const productionOperation =
  "environment-contract-and-inert-backend-deploy";
export const productionApproval =
  "approve-production-environment-contract-and-inert-backend-deploy";

function runGit(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function assertProductionDeployAuthorization({
  deployKey,
  expectedEnvironment,
  operation,
  approval,
  approvedCommit,
  actualCommit,
  worktreeStatus,
}) {
  if (expectedEnvironment !== "production") {
    throw new Error(
      "BBPC_EXPECTED_ENVIRONMENT must be exactly production.",
    );
  }
  if (operation !== productionOperation) {
    throw new Error(
      "BBPC_PRODUCTION_OPERATION does not authorize the inert deployment boundary.",
    );
  }
  if (approval !== productionApproval) {
    throw new Error(
      "BBPC_PRODUCTION_APPROVAL does not match the required exact approval.",
    );
  }
  if (
    typeof approvedCommit !== "string" ||
    !commitPattern.test(approvedCommit)
  ) {
    throw new Error(
      "BBPC_PRODUCTION_APPROVED_COMMIT must be an exact lowercase 40-character commit.",
    );
  }

  const target = assertDeployTarget({
    deployKey,
    expectedDeployment: productionDeployment,
    forbiddenDeployment: stagingDeployment,
  });
  if (target.kind !== "prod") {
    throw new Error(
      "CONVEX_DEPLOY_KEY must use a production deploy-key target.",
    );
  }
  if (
    typeof actualCommit !== "string" ||
    !commitPattern.test(actualCommit.trim()) ||
    actualCommit.trim() !== approvedCommit
  ) {
    throw new Error(
      "The checked-out commit does not match the approved production commit.",
    );
  }
  if (
    typeof worktreeStatus !== "string" ||
    worktreeStatus.trim() !== ""
  ) {
    throw new Error(
      "The production deployment worktree must be completely clean.",
    );
  }

  return {
    deployment: target.deployment,
    commit: approvedCommit,
    operation,
  };
}

export function main(env = process.env) {
  const result = assertProductionDeployAuthorization({
    deployKey: env.CONVEX_DEPLOY_KEY,
    expectedEnvironment: env.BBPC_EXPECTED_ENVIRONMENT,
    operation: env.BBPC_PRODUCTION_OPERATION,
    approval: env.BBPC_PRODUCTION_APPROVAL,
    approvedCommit: env.BBPC_PRODUCTION_APPROVED_COMMIT,
    actualCommit: runGit(["rev-parse", "HEAD"]),
    worktreeStatus: runGit([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
  });

  process.stdout.write(
    [
      "Production deployment authorization guard passed.",
      `deployment=${result.deployment}`,
      `commit=${result.commit}`,
      `operation=${result.operation}`,
      "",
    ].join(" "),
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
        : "Unknown production-authorization error.";
    process.stderr.write(
      `Production deployment authorization guard failed: ${message}\n`,
    );
    process.exitCode = 1;
  }
}
