import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const convexRoot = path.join(root, "convex");
const exemptFiles = new Set([
  "auth.config.ts",
  "convex.config.ts",
  "functions.ts",
  "schema.ts",
]);
const exemptDirectories = new Set(["_generated", "lib"]);
const approvedBuilders = new Set([
  "anonymousQuery",
  "authenticatedQuery",
  "adminQuery",
  "pipelineQuery",
  "recordingQuery",
  "authenticatedMutation",
  "identityLinkMutation",
  "adminMutation",
  "pipelineMutation",
  "recordingMutation",
  "authenticatedReadAction",
  "authenticatedAction",
  "pipelineAction",
  "internalAppMutation",
  "internalMigrationMutation",
  "internalControlMutation",
  "internalReadQuery",
  "internalReadAction",
]);

function listEndpointFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (exemptDirectories.has(entry.name)) {
          return [];
        }
        return listEndpointFiles(absolutePath);
      }
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".ts") ||
        entry.name.endsWith(".test.ts") ||
        exemptFiles.has(entry.name)
      ) {
        return [];
      }
      return [absolutePath];
    });
}

function isExported(node) {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) === true
  );
}

const violations = [];
for (const absolutePath of listEndpointFiles(convexRoot)) {
  const source = fs.readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.initializer === undefined ||
        !ts.isCallExpression(declaration.initializer) ||
        !ts.isIdentifier(declaration.initializer.expression)
      ) {
        continue;
      }
      const builder = declaration.initializer.expression.text;
      if (!approvedBuilders.has(builder)) {
        const location = sourceFile.getLineAndCharacterOfPosition(
          declaration.name.getStart(sourceFile),
        );
        violations.push({
          file: path.relative(root, absolutePath),
          line: location.line + 1,
          endpoint: declaration.name.text,
          builder,
        });
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    [
      "Every exported Convex endpoint must use an approved access-class builder.",
      ...violations.map(
        ({ file, line, endpoint, builder }) =>
          `${file}:${line} ${endpoint} uses unclassified builder ${builder}`,
      ),
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Convex access classification passed.\n");
}
