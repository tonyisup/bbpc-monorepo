---
name: convex-insights
description: "Query a running Convex app's logs + health in natural language (official MCP): failures, slow/expensive functions, deploy causality — scoped, evidence-backed, with a dashboard deep link."
---

<!-- GENERATED from convex-agents content/capabilities/convex-insights.json — do not edit by hand. -->

# Query logs + health in natural language

The deployment already records what happened; the agent just has to ask well. This capability is a disciplined wrapper over the official Convex MCP's read tools (`logs`, `insights`, `functionSpec`, `status`) that turns operational questions into narrow, evidence-returning queries and hands back answers a human can one-click verify in the dashboard. The discipline is copied from the observability MCP surface that works best in the wild: discover fields before querying, three views not fifteen tools, token-frugal output, and a dashboard deep link on every answer.

## Workflow

1. GUARD: deploy-guard step 0-1 — identify + announce which deployment is being read. Reading logs/insights is read-only; never enable prod mutation flags for an insights pass.
2. DISCOVER before you query — never guess identifiers. Use `status` to obtain the `deploymentSelector`, then `functionSpec({deploymentSelector})` for real function names. The MCP `logs` tool accepts `{deploymentSelector, status, entriesLimit, tokensLimit, jsonl, cursor}`; it has a server-side outcome filter but no function/requestId filter. `insights({deploymentSelector})` has no function filter and is cloud dev/prod + user-auth only. Fetch bounded pages and filter function/requestId locally.
3. PICK ONE OF THREE VIEWS and fetch the raw window, then filter locally:
   - failures view → `logs({deploymentSelector, status: "failure", entriesLimit: n, tokensLimit, jsonl: true, cursor})`, then locally group by function + error message, returning counts + the first stack per group. Answers 'what's erroring', 'what failed after deploy'.
   - health view → `insights` (cloud only): the typed 72h read-limit / OCC events. Surface + rank them, but hand perf/cost ROOT-CAUSING and fixes to convex-advisor — emit those as pointer findings, do not own the perf-fix framing here.
   - trace view → `logs({deploymentSelector, status: "all", entriesLimit: n, tokensLimit, jsonl: true, cursor})`, then locally filter one requestId/function to read the full execution. Answers 'why did THIS call fail'.
4. SCOPE with bounded `entriesLimit`/`tokensLimit`, follow `newCursor` only as needed, and filter function/requestId client-side. Aggregate large windows instead of dumping lines.
5. ANSWER with (a) the one-line finding, (b) the evidence (counts + one representative stack/log line), and (c) WHEN POSSIBLE an agent-constructed dashboard deep link (dashboard.convex.dev, the deployment's Logs/Functions view) for human verification — no tool returns the link, so build it from the deployment name + function; never a raw log dump as the answer.
6. CROSS-CHECK deploy causality when asked 'did my deploy break this': compare the failure onset (from the log timestamps) against the deployment version from `status`; correlate, don't assert.
7. HAND OFF, don't fix here: a perf/cost cause → convex-advisor (which owns those fixes); a code defect → convex-reviewer/convex-authz; a live error to react to going forward → monitor/sentinel. Emit findings on the bus (specs/finding.schema.json) — primarily `observability`, with perf/cost as pointer findings to advisor — so a composite pass can pick them up.

## Rules

- Discover real function/field names (functionSpec/status) before filtering — never guess identifiers, never return a confusing empty result for a name the app doesn't have.
- `logs` supports `status` but not function/requestId filters; use its documented MCP argument object and filter the remaining dimensions client-side. `insights` is cloud-only and has no function filter.
- One of three views per question (failures / health / trace) — don't fan out into many speculative tool calls.
- No tool returns a dashboard link — construct it from the deployment name + function when possible for human verification; never answer with a raw log dump.
- Read-only always: an insights pass runs no mutation and never enables prod mutation flags (deploy-guard discipline).
- Stay a reader and defer perf/cost fixes to convex-advisor: emit primarily `observability`, route perf/cost as POINTER findings so advisor uniquely owns the perf-fix framing; forward-looking reaction goes to monitor/sentinel.
