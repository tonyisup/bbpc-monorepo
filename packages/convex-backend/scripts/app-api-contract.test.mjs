import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(?:test|spec)\./u.test(entry.name) &&
        [".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(extname(path))) {
      return [path];
    }
    return [];
  });
}

for (const app of ["web", "admin", "recording"]) {
  test(`${app} runtime uses generated API references instead of manual reference factories`, () => {
    const files = sourceFiles(join(repoRoot, "apps", app, "src"));
    assert.ok(files.length > 0, `No ${app} sources found`);
    const violations = files.filter((path) =>
      /\b(?:makeFunctionReference|publicQueryReference|publicActionReference)\b/u.test(
        readFileSync(path, "utf8"),
      ),
    ).map((path) => relative(repoRoot, path));
    assert.deepEqual(violations, [], "Import api from @tonyisup/bbpc-convex-api; do not hand-declare app endpoint contracts.");
  });
}
