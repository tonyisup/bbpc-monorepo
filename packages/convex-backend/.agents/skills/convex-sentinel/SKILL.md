---
name: convex-sentinel
description: "Set up Sentinel production error capture in your own Convex deployment."
---

<!-- GENERATED from convex-agents content/capabilities/sentinel.json — do not edit by hand. -->

# Capture production errors in your own deployment

Install `@convex-dev/sentinel` to store production errors in the user's own deployment, redacted at write time, then react to new ones. Storage stays in that deployment; when an agent reads evidence, the minimized/redacted content may be transmitted to the configured model provider and requires explicit user consent for that provider boundary.

## Workflow

1. Install the component: `app.use(sentinel)` in `convex/convex.config.ts`.
2. Wire the client SDK: a React error boundary plus `window.onerror`/`unhandledrejection` and breadcrumbs.
3. Redaction runs at write time and is on by default (default-deny on secret key names and value patterns).
4. Read recent errors with the Convex CLI (`convex data`, `run-once-query`); react to new ones via the monitor's `prod_error` event.
5. Optionally enable the self-healing cron only after convex-self-heal's guard is installed and approved. ai-runner may prepare branch-only repairs after triage, certification, and append-only audit logging; it never merges or deploys, and a human retains the merge boundary.

## Rules

- Redaction is mandatory and on by default — never store raw secrets; the agent's reads reach the model provider.
- Error storage stays in the user's deployment. Before an agent/model reads it, obtain consent for the configured model provider and transmit only redacted, minimized evidence; do not imply that model processing remains inside Convex.
- ai-runner requires the convex-self-heal guard: branch-only repair, full certification, append-only auditing, and human merge are mandatory.
- Sample and cap to control volume and cost.
- Capturing PROD errors needs a deployed cloud app; install works anonymously.
