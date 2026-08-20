---
name: convex-migrate
description: "Migrate schema + backfill data on a deployed Convex app using @convex-dev/migrations."
---

<!-- GENERATED from convex-agents content/capabilities/migrate.json — do not edit by hand. -->

# Migrate the schema / data on a live app

Change a deployed schema without breaking existing data: stage the schema change, install @convex-dev/migrations, write a backfill that makes old rows valid, run it, and verify before tightening the validator.

## Workflow

1. Read the generated Convex guidance, then make application readers and writers compatible with both the old and new document shapes. Keep this mixed-state compatibility until migration completes.
2. Install `@convex-dev/migrations`, register it in `convex/convex.config.ts` with `app.use(migrations)`, initialize `new Migrations(components.migrations, { schema })`, run code generation, and deploy this setup to the explicitly selected non-production target before defining or running a backfill.
3. Make the new field optional (so existing rows remain valid), deploy the compatible readers/writers and schema, and smoke-test both old and new shapes.
4. Write and run the batched migration; verify row counts and that every row is valid while mixed-state readers/writers remain in place.
5. Tighten the validator only after the backfill completes, deploy and verify again, then remove temporary compatibility fallback code in a later safe deploy.

## Rules

- Never tighten a validator before the backfill completes — it rejects existing rows and breaks the live app.
- Add new fields as optional first, migrate, then require.
- Readers and writers must handle both shapes throughout the deployment/backfill window; remove compatibility only after the tightened schema is verified.
- Verify row counts before and after.
