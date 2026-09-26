import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  productionDeployment,
  stagingDeployment,
} from "./check-production-deploy-authorization.mjs";

const workflowsDirectory = path.resolve(
  import.meta.dirname,
  "../../../.github/workflows",
);
const production = fs.readFileSync(
  path.join(workflowsDirectory, "deploy-production.yml"),
  "utf8",
);
const staging = fs.readFileSync(
  path.join(workflowsDirectory, "deploy-staging.yml"),
  "utf8",
);
const [verifyJob, deployJob] = production
  .slice(production.indexOf("\njobs:"))
  .split(/\n {2}deploy:\n/u);

test("production deploys only run from main", () => {
  assert.match(production, /push:\n {4}branches:\n {6}- main\n/u);
  assert.doesNotMatch(production, /pull_request/u);
  assert.equal(
    production.match(/if: github\.ref == 'refs\/heads\/main'/gu)?.length,
    2,
  );
  assert.match(production, /group: bbpc-convex-production/u);
  assert.match(production, /cancel-in-progress: false/u);
});

test("the production key is only exposed after owner approval", () => {
  assert.ok(verifyJob !== undefined && deployJob !== undefined);
  assert.doesNotMatch(verifyJob, /secrets\./u);
  assert.doesNotMatch(verifyJob, /environment:/u);
  assert.match(deployJob, /needs: verify/u);
  assert.match(deployJob, /environment: convex-production/u);
  assert.match(
    deployJob,
    /CONVEX_DEPLOY_KEY: \$\{\{ secrets\.CONVEX_PRODUCTION_DEPLOY_KEY \}\}/u,
  );
  // The staging workflow must never be able to reach production.
  assert.doesNotMatch(staging, /CONVEX_PRODUCTION_DEPLOY_KEY|convex-production/u);
});

test("an unprotected production environment stops the run before any secret", () => {
  const guard = verifyJob.indexOf(
    "name: Require owner approval on the production environment",
  );
  const install = verifyJob.indexOf("pnpm install --frozen-lockfile");
  assert.ok(guard >= 0 && install > guard);
  assert.match(verifyJob, /permissions:\n\s+contents: read\n\s+actions: read\n/u);
  assert.match(
    verifyJob,
    /gh api "repos\/\$GITHUB_REPOSITORY\/environments\/convex-production"\) \|\| \{/u,
  );
  assert.match(verifyJob, /select\(\.type == "required_reviewers"\)/u);
  assert.match(verifyJob, /\.deployment_branch_policy == null/u);
  assert.match(verifyJob, /\[ "\$reviewers" -lt 1 \] \|\| \[ "\$branches" != "restricted" \]/u);
});

test("production pins its target and verifies it before deploying", () => {
  assert.match(
    deployJob,
    new RegExp(`BBPC_EXPECTED_CONVEX_DEPLOYMENT: ${productionDeployment}`, "u"),
  );
  assert.match(
    deployJob,
    new RegExp(`BBPC_FORBIDDEN_CONVEX_DEPLOYMENT: ${stagingDeployment}`, "u"),
  );
  assert.match(deployJob, /BBPC_EXPECTED_ENVIRONMENT: production/u);

  const target = deployJob.indexOf("pnpm run deploy:target:check");
  const environment = deployJob.indexOf("pnpm run deploy:environment:check");
  const deploy = deployJob.indexOf("npx convex deploy");
  const contract = deployJob.indexOf("pnpm run contract:compare");
  assert.ok(target >= 0 && environment > target);
  assert.ok(deploy > environment);
  assert.ok(contract > deploy);
  assert.match(deployJob, /--typecheck enable/u);
  assert.match(verifyJob, /pnpm run check\n\s+pnpm run package:check/u);
});
