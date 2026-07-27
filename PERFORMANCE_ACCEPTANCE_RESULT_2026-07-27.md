# Production-Scale Local Performance Acceptance — 2026-07-27

Status: **all six public and authenticated SQL-baseline workflows pass**

This record contains aggregate timing, cardinality, and byte-count evidence only. It
does not contain migrated row values, page content, resource URLs, credentials, tokens,
or Clerk identity claims.

## Inputs and method

- SQL baseline: production-derived, read-only `dev` clone
- SQL baseline generated: 2026-07-23
- Source schema fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Convex target: strict identity-bearing third local rehearsal in write-disabled S1
- Warm-up requests per workload: 3
- Sequential requests per workload: 25
- Concurrency rounds: 8 at levels 1 and 4
- p95 regression threshold: no more than 20%

The guarded benchmarks accept only an HTTP localhost Convex URL. Their private JSON
artifacts are mode `0600` under the third run directory and record aggregate metrics
only. The authenticated harness also requires a private local configuration and three
minimal, distinct identity files; it never emits the local admin key or identity claims.

## SQL-to-Convex results

| Workflow | SQL p95 | Convex p50 | Convex p95 | Convex p99 | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Latest published episode graph | 32.392 ms | 0.343 ms | 0.959 ms | 1.527 ms | -97.039% |
| 50-episode archive page | 92.139 ms | 0.847 ms | 1.410 ms | 1.905 ms | -98.470% |
| Current-season performance | 33.789 ms | 0.342 ms | 0.404 ms | 0.541 ms | -98.804% |
| Administrator dashboard | 33.322 ms | 0.363 ms | 0.467 ms | 0.623 ms | -98.599% |
| Member ranked lists | 30.492 ms | 0.276 ms | 0.385 ms | 0.466 ms | -98.737% |
| Pipeline episode bundle | 39.658 ms | 0.263 ms | 0.786 ms | 0.843 ms | -98.018% |

All six workloads passed at sequential p95 and returned the expected bounded
cardinality. Their four-request concurrency p95s ranged from 0.601 ms to 3.032 ms,
with zero observed errors.

The SQL and Convex payloads are not shape-identical: Convex returns the migrated
consumer DTO rather than the narrower SQL baseline projection. Payload bytes are
therefore recorded as absolute response-budget inputs, not treated as a parity failure.
The largest measured response was the bounded 50-episode page at 97,077 bytes.

## Migration throughput

Both rehearsals reconciled the same 9,283 SQL-derived canonical rows, all eight domains,
and all 62 checkpoints against the same source fingerprint.

| Run | Wall time | SQL rows/second | Acceptance outcome |
| --- | ---: | ---: | --- |
| `dev-rehearsal-20260724-01` | 537.049 s | 17.285 | Reconciled; checkpoint-safe defect recovery included |
| `dev-rehearsal-20260727-02` | 440.441 s | 21.077 | Reconciled cleanly; backup, restore, replay, and S2 rollback passed |
| `dev-rehearsal-20260727-03` | 477.367 s | 19.446 | Strict identity/performance gate, backup, restore, replay, and S2 rollback passed |

The fastest clean run was 17.989% shorter than the first and its throughput was 21.934%
higher. The second
portable snapshot was created and its exact disposable restore was validated within
114.440 seconds. Migration plus restore validation therefore completed in 554.881
seconds (9 minutes 15 seconds) before operator buffer. The strict third run completed
its core migration in 477.367 seconds and its restore validation in 105.513 seconds,
for 582.880 seconds (9 minutes 43 seconds) combined.

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

## Remaining production gate

The strict third run closes the local authenticated-performance gap. No production SLO
is inferred from localhost latency. T16 must still record deployed Convex and Vercel
canary p50/p95/p99, response bytes, error rate, and platform scan metrics before S3.
