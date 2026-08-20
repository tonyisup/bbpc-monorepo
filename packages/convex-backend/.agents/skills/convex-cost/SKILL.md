---
name: convex-cost
description: "Preview total Convex spend across function calls and compute, database/file/search storage, search operations, bandwidth/egress, and read volume; label partial estimates and confirm paid actions."
---

<!-- GENERATED from convex-agents content/capabilities/convex-cost.json — do not edit by hand. -->

# Preview what this app will cost

This capability makes Convex spend legible across every available billing meter, attributes usage to its drivers, projects growth, and names the cheapest fix. Before any metered action, state the price and recurrence and get an explicit yes.

## Workflow

1. GUARD: deploy-guard — a cost read is read-only over dev/prod (insights is cloud+user-auth only; not previews). Announce the deployment.
2. GATHER every available meter from official dashboard/export/MCP evidence: function calls and action compute, database bandwidth and storage, file storage and bandwidth/egress, vector/full-text search storage and operations, plus `insights`, `tables`, and `functionSpec` for attribution. If a meter is unavailable, name it and label the result PARTIAL. With no traffic, estimate only the observable code shapes and say what is unknown.
3. ATTRIBUTE using the relevant meter and observed volume; do not rank total-cost fixes from read volume alone. For read-heavy functions, show bytes/documents per call × call volume. For actions, storage, search, and egress, show their own units and volume.
4. PROJECT: state how the top drivers scale — a full-table `.collect()` grows LINEARLY with the table (cost compounds as data accumulates); an indexed `.take(n)` stays flat. Give the user the shape of the curve ('this is O(table size) per call — fine at 1k rows, a bill at 1M'), not a false-precision dollar figure.
5. NAME THE CHEAPEST FIX per driver — index + `.withIndex` instead of scan, `.paginate`/`.take` instead of `.collect`, an aggregate component for counts, caching a hot read — and emit it as a cost-class finding on the bus (evidence: the insight event + the projected growth) pointing at convex-expert/convex-advisor for the actual change.
6. CONFIRM-COST for paid actions: if the flow includes anything metered (a domain purchase, cloud provisioning, a plan change), STATE the price and recurrence explicitly and get an explicit yes BEFORE proceeding — never let a paid action happen as a side effect (the cost-confirm gate).
7. REPORT: the current cost drivers ranked across available meters, each with evidence + growth shape + fix, and a plain bottom line. State a numeric improvement only when calculated from observed baseline and post-fix data (or clearly labeled illustrative bounds); otherwise describe the qualitative change. Cite current pricing for absolute numbers and label partial coverage.

## Rules

- Total cost spans multiple meters. For database reads, always show data-read-per-call × call-volume; for other meters, use their corresponding measured unit and volume.
- Read the deployment's own insights/bytes-read evidence for spend; with no traffic yet, price the query SHAPES (a scan on a growing table is a future cost).
- Give the growth CURVE, not false-precision dollars: O(table) scans compound as data accumulates; indexed access stays flat. Cite the pricing page for absolute figures.
- Every cost driver names its cheapest fix and emits a cost-class finding on the bus pointing at the fixer (convex-expert/advisor).
- Confirm-cost for any metered/paid action: state the price + recurrence and get an explicit yes BEFORE it happens — never as a side effect.
- Read-only over dev/prod (deploy-guard); insights is cloud+user-auth only. Cost composes convex-advisor's evidence but frames it as money, not latency.
