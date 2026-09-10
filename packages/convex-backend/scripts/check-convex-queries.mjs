import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const convexRoot = path.join(root, "convex");
const allowedAnnotation =
  /^\s*\/\/\s*convex-query-audit:\s*allow-(collect|filter|take)\s+\S.{9,}$/u;

function listTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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

// Query provenance comes from TypeScript, so arrays and unrelated filter methods
// are ignored even after aliases, awaits, or helper calls.
export function auditSourceFile(sourceFile, checker) {
  const violations = [];
  const lines = sourceFile.text.split(/\r?\n/u);
  function isDatabaseQuery(expression) {
    const type = checker.getTypeAtLocation(expression);
    return (
      type.getProperty("collect") !== undefined &&
      type.getProperty("paginate") !== undefined
    );
  }
  function hasIndex(expression, seen = new Set()) {
    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression)
    ) {
      if (
        ["withIndex", "withSearchIndex"].includes(
          expression.expression.name.text,
        )
      )
        return true;
      return hasIndex(expression.expression.expression, seen);
    }
    if (ts.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression);
      if (symbol === undefined || seen.has(symbol)) return false;
      seen.add(symbol);
      return (
        symbol.declarations?.some(
          (declaration) =>
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            hasIndex(declaration.initializer, seen),
        ) ?? false
      );
    }
    return false;
  }
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method = node.expression.name.text;
      if (
        ["collect", "filter", "take"].includes(method) &&
        isDatabaseQuery(node.expression.expression) &&
        (method !== "take" || !hasIndex(node.expression.expression))
      ) {
        const location = sourceFile.getLineAndCharacterOfPosition(
          node.expression.name.getStart(sourceFile),
        );
        if (!hasAuditAnnotation(lines, location.line, method))
          violations.push({ line: location.line + 1, method });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

export function auditProject() {
  const files = listTypeScriptFiles(convexRoot);
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  return files.flatMap((absolutePath) =>
    auditSourceFile(program.getSourceFile(absolutePath), checker).map(
      (violation) => ({
        file: path.relative(root, absolutePath),
        ...violation,
      }),
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const violations = auditProject();
  if (violations.length > 0) {
    process.stderr.write(
      [
        "Convex database scans require an explicit audit (collect, filter, or take without an index).",
        ...violations.map(
          ({ file, line, method }) =>
            `${file}:${line} .${method}() requires ` +
            `// convex-query-audit: allow-${method} <reason of at least 10 characters>`,
        ),
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else process.stdout.write("Convex query audit passed.\n");
}
