---
name: convex-seed
description: "Seed or import data into the Convex database."
---

<!-- GENERATED from convex-agents content/capabilities/seed.json — do not edit by hand. -->

# Seed / import data

Populate tables via an internalMutation seed function or the repository-pinned Convex import command, matching the schema and using stable-key upserts on shared targets.

## Workflow

1. Run convex-deploy-guard first: identify and announce the exact target. Stop on production, an unclear target, or a shared deployment without explicit scoped approval.
2. For fixtures, write an internalMutation that performs stable-key upserts and run it with the repository-pinned CLI against the explicit target.
3. For bulk import, shape data to the schema and use the repository-pinned `convex import --deployment <target>` only after reviewing its mode. Never use `--replace`, clear-then-insert, or table clearing on a shared deployment.
4. Verify row counts and stable keys without exposing sensitive rows.

## Rules

- Seed via internalMutation or convex import, matching validators.
- Make seeding idempotent.
- Shared deployments use stable-key upserts only; destructive clear/replace seeding is forbidden.
- Never seed secrets/PII into a shared deployment.
