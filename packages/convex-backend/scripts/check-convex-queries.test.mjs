import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { auditSourceFile } from "./check-convex-queries.mjs";

function check(body) {
  const filename = "/query-audit-fixture.ts";
  const source = `interface Query { collect(): Promise<number[]>; paginate(): unknown; take(n:number): Promise<number[]>; filter(fn:unknown): Query; withIndex(name:string): Query; }
    declare const ctx: { db: { query(name:string): Query } };
    async function fixture() { ${body} }`;
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) =>
    name === filename ? file : getSourceFile(name, ...args);
  const program = ts.createProgram([filename], {}, host);
  return auditSourceFile(file, program.getTypeChecker()).map((v) => v.method);
}

test("array filters and unrelated methods are not database queries", () => {
  assert.deepEqual(
    check(
      `const rows = await ctx.db.query("items").withIndex("by_name").take(10); rows.filter(Boolean); [1,2].filter(Boolean);`,
    ),
    [],
  );
});
test("actual query filters and collect are diagnosed through aliases", () => {
  assert.deepEqual(
    check(
      `const rows = ctx.db.query("items"); rows.filter(Boolean); rows.collect();`,
    ),
    ["filter", "collect"],
  );
});
test("unindexed take scans require an audit, indexed aliases do not", () => {
  assert.deepEqual(
    check(
      `ctx.db.query("items").take(500); const rows = ctx.db.query("items").withIndex("by_name"); rows.take(10);`,
    ),
    ["take"],
  );
});
test("only a reasoned annotation suppresses a database diagnostic", () => {
  assert.deepEqual(
    check(`ctx.db.query("items")
    // convex-query-audit: allow-take bounded configuration catalog with overflow rejection
    .take(30);`),
    [],
  );
  assert.deepEqual(
    check(`ctx.db.query("items")
    // convex-query-audit: allow-take ok
    .take(30);`),
    ["take"],
  );
});
