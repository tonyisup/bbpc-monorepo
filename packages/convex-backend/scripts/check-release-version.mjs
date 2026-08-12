import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const expectedTag = `v${packageJson.version}`;
const actualTag = process.env.GITHUB_REF_NAME;

if (actualTag === undefined) {
  process.stdout.write(
    `Release version passed outside CI. expectedTag=${expectedTag}\n`,
  );
} else if (actualTag !== expectedTag) {
  process.stderr.write(
    `Release tag ${actualTag} does not match package version ${packageJson.version}.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Release version passed. tag=${actualTag}\n`);
}
