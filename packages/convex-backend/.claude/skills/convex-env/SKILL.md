---
name: convex-env
description: "Set and wire Convex deployment env vars / secrets for the app."
---

<!-- GENERATED from convex-agents content/capabilities/env.json — do not edit by hand. -->

# Manage env vars + secrets

Store backend secrets as Convex deployment environment variables using the repository-pinned CLI, read them with process.env in actions, and never commit or print them.

## Workflow

1. Identify and announce an explicit target with deploy-guard. Set a non-secret value with `pnpm --filter @tonyisup/bbpc-convex-api exec convex env set KEY "value" --deployment <target>` (or `--prod` after fresh production consent and checks). For secrets, omit the value for interactive input, pipe it through stdin, or use a protected `--from-file`; never put a secret value in shell history, logs, or command arguments. Use `--from-file` for PEM/JSON or multiple values.
2. Read via process.env.KEY inside actions (not queries/mutations).
3. Use `.env.local` only for local tooling and deployment-selection metadata. Backend-required values must be set on the explicitly selected local/dev/staging/prod Convex deployment; a local file does not configure the cloud backend.
4. Confirm names only with `pnpm --filter @tonyisup/bbpc-convex-api exec convex env list --names-only --deployment <target>` (or use the dashboard). Never list secret values for verification.

## Rules

- Secrets live in Convex env vars, never in code or git.
- process.env only in actions ('use node' if needed), not queries/mutations.
- Different deployments need their own values.
- Every CLI operation names its deployment explicitly; production also requires deploy-guard's fresh confirmation and repository checks.
