# Production-Scale Local Performance Acceptance — 2026-07-27

Status: **comparable public workflows pass; authenticated runtime matrix remains gated**

This record contains aggregate timing, cardinality, and byte-count evidence only. It
does not contain migrated row values, page content, resource URLs, credentials, tokens,
or Clerk identity claims.

## Inputs and method

- SQL baseline: production-derived, read-only `dev` clone
- SQL baseline generated: 2026-07-23
- Source schema fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Convex target: production-derived local portable restore
- Warm-up requests per workload: 3
- Sequential requests per workload: 25
- Concurrency rounds: 8 at levels 1 and 4
- p95 regression threshold: no more than 20%

The guarded benchmark accepts only an HTTP localhost Convex URL. Its private JSON
artifact is mode `0600` under `.local-migration/performance/` and records aggregate
metrics only.

## Comparable SQL-to-Convex results

| Workflow | SQL p95 | Convex p95 | Change | Convex p95 response |
| --- | ---: | ---: | ---: | ---: |
| Latest published episode graph | 32.392 ms | 1.219 ms | -96.237% | 1,630 B |
| 50-episode archive page | 92.139 ms | 1.341 ms | -98.545% | 97,069 B |
| Current-season performance | 33.789 ms | 0.529 ms | -98.434% | 14,372 B |

All three comparable workloads passed at sequential p95 and returned the expected
bounded cardinality. Their four-request concurrency p95s were 1.471 ms, 3.275 ms, and
0.980 ms respectively, with zero observed errors.

The SQL and Convex payloads are not shape-identical: Convex returns the migrated
consumer DTO rather than the narrower SQL baseline projection. Payload bytes are
therefore recorded as absolute response-budget inputs, not treated as a parity failure.
The largest measured response was the bounded 50-episode page at 97,069 bytes.

## Migration throughput

Both rehearsals reconciled the same 9,283 SQL-derived canonical rows, all eight domains,
and all 62 checkpoints against the same source fingerprint.

| Run | Wall time | SQL rows/second | Acceptance outcome |
| --- | ---: | ---: | --- |
| `dev-rehearsal-20260724-01` | 537.049 s | 17.285 | Reconciled; checkpoint-safe defect recovery included |
| `dev-rehearsal-20260727-02` | 440.441 s | 21.077 | Reconciled cleanly; backup, restore, replay, and S2 rollback passed |

The clean run was 17.989% shorter and its throughput was 21.934% higher. The second
portable snapshot was created and its exact disposable restore was validated within
114.440 seconds. Migration plus restore validation therefore completed in 554.881
seconds (9 minutes 15 seconds) before operator buffer.

## Development-browser diagnostic

The local Next.js development servers were sampled ten times per route after one warm-up
navigation. All 60 measured navigations returned HTTP 200.

| Application | Route | p95 load | p95 TTFB | p95 FCP |
| --- | --- | ---: | ---: | ---: |
| `bbpc` | `/` | 554.1 ms | 228.7 ms | 480 ms |
| `bbpc` | `/episodes` | 910.7 ms | 231.0 ms | 584 ms |
| `bbpc` | `/history` | 1,312.6 ms | 895.6 ms | 1,160 ms |
| `bbpc` | `/year` | 457.2 ms | 222.8 ms | 468 ms |
| `bbpc` | `/game` | 567.3 ms | 225.9 ms | 476 ms |
| `bbpc-admin` | `/` anonymous gate | 241.3 ms | 7.3 ms | unavailable |

These are development-mode diagnostics, not release SLO evidence. The public
`/history` p95 contains a development-server outlier and must be remeasured against the
production Vercel deployment during T16 canary validation. Production builds, direct
legacy-endpoint denials, SQL-unreachable browser sweeps, and authenticated route
acceptance are recorded separately in the migration plan.

## Remaining performance gate

The SQL baseline also includes authenticated administrator, member-ranked-list, and
pipeline workflows. A zero-identity restored target cannot reproduce their successful
runtime path without provisioned principals. Their bounded-query lint, function tests,
consumer tests, and prior authenticated browser/service acceptance pass, but a
repeatable direct runtime p50/p95/p99 comparison remains coupled to the final decision
about identity-bearing rehearsal targets.

No production SLO is inferred from localhost latency. T16 must record deployed Convex
and Vercel canary p50/p95/p99, response bytes, error rate, and platform scan metrics
before S3.
