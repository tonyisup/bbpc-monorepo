import assert from "node:assert/strict";
import test from "node:test";

import {
  compareP95,
  metrics,
  pacificToday,
  percentile,
  requireLocalConvexUrl,
} from "./benchmark-public.mjs";

test("uses nearest-rank percentiles and stable metrics", () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(percentile(values, 50), 30);
  assert.equal(percentile(values, 95), 50);
  assert.deepEqual(metrics(values), {
    samples: 5,
    p50: 30,
    p95: 50,
    p99: 50,
    max: 50,
  });
});

test("applies the twenty-percent p95 regression gate", () => {
  assert.equal(compareP95(100, 120).status, "pass");
  assert.equal(compareP95(100, 120.001).status, "fail");
  assert.equal(compareP95(100, 80).regressionPercent, -20);
});

test("accepts only plaintext localhost Convex URLs", () => {
  assert.equal(
    requireLocalConvexUrl("http://127.0.0.1:3210/"),
    "http://127.0.0.1:3210",
  );
  assert.equal(
    requireLocalConvexUrl("http://localhost:3210"),
    "http://localhost:3210",
  );
  assert.throws(
    () => requireLocalConvexUrl("https://example.convex.cloud"),
    /localhost deployment/u,
  );
});

test("formats the benchmark date in Pacific time", () => {
  assert.equal(
    pacificToday(new Date("2026-07-28T06:30:00.000Z")),
    "2026-07-27",
  );
});
