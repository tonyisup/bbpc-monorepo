import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const convexRoot = path.join(root, "convex");
const allowedAnnotation =
  /^\s*\/\/\s*convex-query-audit:\s*allow-(collect|filter)\s+\S.{9,}$/u;

function listTypeScriptFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_generated") {
          return [];
        }
        return listTypeScriptFiles(absolutePath);
      }
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".ts") ||
        entry.name.endsWith(".test.ts")
      ) {
        return [];
      }
      return [absolutePath];
    });
}

function hasAuditAnnotation(lines, lineNumber, method) {
  const candidates = [
    lines[lineNumber],
    lineNumber > 0 ? lines[lineNumber - 1] : undefined,
  ];
  return candidates.some((line) => {
    if (line === undefined) {
      return false;
    }
    const match = allowedAnnotation.exec(line);
    return match?.[1] === method;
  });
}

const violations = [];
for (const absolutePath of listTypeScriptFiles(convexRoot)) {
  const source = fs.readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const lines = source.split(/\r?\n/u);

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      if (method === "collect" || method === "filter") {
        const location = sourceFile.getLineAndCharacterOfPosition(
          node.expression.name.getStart(sourceFile),
        );
        if (!hasAuditAnnotation(lines, location.line, method)) {
          violations.push({
            file: path.relative(root, absolutePath),
            line: location.line + 1,
            method,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length > 0) {
  process.stderr.write(
    [
      "Unbounded Convex query patterns require an explicit audit.",
      ...violations.map(
        ({ file, line, method }) =>
          `${file}:${line} .${method}() requires ` +
          `// convex-query-audit: allow-${method} <reason of at least 10 characters>`,
      ),
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Convex query audit passed.\n");
}
