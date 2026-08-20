---
name: convex-monitor
description: "Watch for the next dev/prod error or request in a Convex app and react to it."
---

<!-- GENERATED from convex-agents content/capabilities/monitor.json — do not edit by hand. -->

# Watch for the next thing to react to

Watch the repository-supported local logs, Convex MCP logs cursor, and Sentinel prod-error rows for the next typed event; return the first to fire or a quiet heartbeat.

## Workflow

1. Use a repository-registered blocking event tool only if its schema explicitly supports `{project_dir, event_kinds, timeout_ms}`. Otherwise polling is the default: read local error output, fetch Convex MCP logs with `deploymentSelector` + `cursor`, and query Sentinel only when installed.
2. Preserve the typed contract. On kind=convex_error/next_error: decode and fix it. On kind=prod_error: triage (see sentinel) and fix. On kind=feature_request: build it. On kind=quiet: continue until the user-selected timeout.
3. Poll no faster than once per second. While no event arrives, exponentially back off (for example 1s, 2s, 4s, 8s, capped at 30s); after processing any event, reset to the 1s minimum. Persist the logs cursor so entries are not replayed.

## Rules

- Never call an undefined `wait_for_event`; use it only when the repository/harness has registered the stated contract, otherwise use bounded polling.
- Every polling loop has a minimum delay, capped exponential backoff while quiet, reset after an event, and a user-selected overall timeout.
- The event schema is fixed and versioned — the same trigger yields the same typed event.
- Prod events (kind=prod_error) require a deployed cloud app plus Sentinel.
