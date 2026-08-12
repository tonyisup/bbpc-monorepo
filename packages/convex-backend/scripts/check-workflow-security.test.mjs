import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workflowsDirectory = path.join(repositoryRoot, ".github", "workflows");
const immutableGitHubActionReference = /^[^@\s]+@[0-9a-f]{40}$/u;

const workflowFiles = fs
  .readdirSync(workflowsDirectory)
  .filter((fileName) => /\.ya?ml$/u.test(fileName))
  .sort();

test("remote GitHub Actions are pinned to immutable commits", () => {
  assert.ok(workflowFiles.length > 0);

  for (const fileName of workflowFiles) {
    const workflow = fs.readFileSync(
      path.join(workflowsDirectory, fileName),
      "utf8",
    );
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^#\s]+)/gmu)];

    for (const [, actionReference] of actionReferences) {
      if (actionReference.startsWith("./")) {
        continue;
      }
      assert.match(
        actionReference,
        immutableGitHubActionReference,
        `${fileName} must pin ${actionReference} to a full commit SHA`,
      );
    }
  }
});

test("publication and deployment controls have an explicit owner", () => {
  const codeowners = fs.readFileSync(
    path.join(repositoryRoot, ".github", "CODEOWNERS"),
    "utf8",
  );

  assert.match(codeowners, /^\/\.github\/CODEOWNERS @tonyisup$/mu);
  assert.match(codeowners, /^\/\.github\/workflows\/ @tonyisup$/mu);
  assert.match(
    codeowners,
    /^\/packages\/convex-backend\/scripts\/check-\*\.mjs @tonyisup$/mu,
  );
});
