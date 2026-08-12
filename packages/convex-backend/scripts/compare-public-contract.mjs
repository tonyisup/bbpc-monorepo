import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const contractTypeNames = ["PublicApiType", "InternalApiType"];

function compactPrintedNode(printer, node, sourceFile) {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, sourceFile)
    .replace(/\s+/gu, " ")
    .trim();
}

function canonicalTypeNode(typeNode, sourceFile) {
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: true,
  });
  const transformer = (context) => {
    const visit = (node) => {
      const visited = ts.visitEachChild(node, visit, context);
      if (ts.isTypeLiteralNode(visited)) {
        const members = [...visited.members].sort((left, right) =>
          compactPrintedNode(printer, left, sourceFile).localeCompare(
            compactPrintedNode(printer, right, sourceFile),
            "en",
          ),
        );
        return context.factory.updateTypeLiteralNode(
          visited,
          members,
        );
      }
      if (ts.isUnionTypeNode(visited)) {
        const types = [...visited.types].sort((left, right) =>
          compactPrintedNode(printer, left, sourceFile).localeCompare(
            compactPrintedNode(printer, right, sourceFile),
            "en",
          ),
        );
        return context.factory.updateUnionTypeNode(
          visited,
          types,
        );
      }
      if (ts.isIntersectionTypeNode(visited)) {
        const types = [...visited.types].sort((left, right) =>
          compactPrintedNode(printer, left, sourceFile).localeCompare(
            compactPrintedNode(printer, right, sourceFile),
            "en",
          ),
        );
        return context.factory.updateIntersectionTypeNode(
          visited,
          types,
        );
      }
      return visited;
    };
    return (rootNode) => ts.visitNode(rootNode, visit);
  };
  const result = ts.transform(typeNode, [transformer]);
  try {
    return compactPrintedNode(
      printer,
      result.transformed[0],
      sourceFile,
    );
  } finally {
    result.dispose();
  }
}

function parseContract(source, label) {
  const sourceFile = ts.createSourceFile(
    `${label}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`${label} is not valid TypeScript.`);
  }
  return sourceFile;
}

function findTypeAlias(sourceFile, typeName, label) {
  const matches = sourceFile.statements.filter(
    (statement) =>
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === typeName,
  );
  if (matches.length !== 1) {
    throw new Error(
      `${label} must declare exactly one ${typeName}.`,
    );
  }
  return matches[0];
}

export function canonicalContract(source, label = "Contract") {
  const sourceFile = parseContract(source, label);
  return Object.fromEntries(
    contractTypeNames.map((typeName) => [
      typeName,
      canonicalTypeNode(
        findTypeAlias(sourceFile, typeName, label).type,
        sourceFile,
      ),
    ]),
  );
}

export function assertEquivalentContracts(
  committedSource,
  deployedSource,
) {
  const committed = canonicalContract(
    committedSource,
    "Committed contract",
  );
  const deployed = canonicalContract(
    deployedSource,
    "Deployed contract",
  );
  for (const typeName of contractTypeNames) {
    if (committed[typeName] !== deployed[typeName]) {
      throw new Error(
        `Deployed ${typeName} does not match the committed contract.`,
      );
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2) {
    throw new Error(
      "Expected committed and deployed contract file paths.",
    );
  }
  const [committedPath, deployedPath] = argv;
  assertEquivalentContracts(
    fs.readFileSync(committedPath, "utf8"),
    fs.readFileSync(deployedPath, "utf8"),
  );
  process.stdout.write(
    "Deployed public contract matches committed semantics. comparedTypes=2\n",
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
        : "Unknown contract comparison error.";
    process.stderr.write(`Contract comparison failed: ${message}\n`);
    process.exitCode = 1;
  }
}
