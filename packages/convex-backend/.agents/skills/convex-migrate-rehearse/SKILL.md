---
name: convex-migrate-rehearse
description: "Rehearse a live-app schema change + backfill on a snapshot-seeded preview deployment, verify, then promote the proven change to prod with the snapshot as rollback."
---

<!-- GENERATED from convex-agents content/capabilities/migrate-rehearse.json — do not edit by hand. -->

# Rehearse a schema change on a preview before prod

A schema push on Convex validates every existing document against the new schema and FAILS the push if any row doesn't conform — a real data-conformance gate. The safe way to use that gate is to let it fail on a rehearsal copy, not on prod. This capability turns a preview deployment into that copy: seed it with a prod snapshot, push the new schema + run the backfill there, watch the gate, and only promote once it's green. It composes deploy-guard (target classification), migrate (the optional-then-tighten pattern), and @convex-dev/migrations (the batched, resumable backfill).

## Workflow

0. PRECONDITION: preview deployments need a Preview Deploy Key exported as `CONVEX_DEPLOY_KEY` before `--preview-create`/`--preview-name`; a plain CLI login cannot create them. Preview deployments are available on Free and Starter as well as higher plans, with plan-dependent retention. Use only an approved isolated preview/staging target for a real production snapshot. If unavailable, stop or use a sanitized snapshot in an approved isolated target—never a personal/shared dev deployment.
1. GUARD: classify and announce the explicit SOURCE (prod, read-only) and rehearsal target. This does not pre-authorize promotion; production approval must be requested fresh at the later production action boundary.
2. SNAPSHOT the explicit source read-only with the pinned CLI: `pnpm --filter @tonyisup/bbpc-convex-api exec convex export --prod --path snapshot.zip` after the production-read announcement (or `--deployment <source-deployment>`). Add `--include-file-storage` only if required.
3. CREATE the isolated preview FROM THE PRE-CHANGE CODE before editing schema.ts: `pnpm --filter @tonyisup/bbpc-convex-api exec convex deploy --preview-create migrate-<slug>`. Seed it with `pnpm --filter @tonyisup/bbpc-convex-api exec convex import snapshot.zip --deployment migrate-<slug>`.
4. SET UP MIGRATIONS before a backfill: install `@convex-dev/migrations`; register it with `app.use(migrations)`; initialize `new Migrations(components.migrations, { schema })`; run code generation; deploy that setup to the same preview.
5. REHEARSE on the same preview with the pinned CLI and `--preview-name migrate-<slug>`: (a) make readers and writers compatible with old and new shapes, make the changed field optional, deploy, and smoke-test the mixed-state window; (b) run the batched migration against the explicit preview and verify every row; (c) tighten the validator, deploy and smoke-test again; (d) only then remove temporary compatibility fallback code and redeploy.
6. VERIFY on the preview: run the app's functions against migrated data with the preview deploymentSelector or `pnpm --filter @tonyisup/bbpc-convex-api exec convex run <function> --deployment migrate-<slug>`.
7. PROMOTE only after repeating deploy-guard target classification and obtaining fresh explicit approval immediately before the first production action. Run the environment and production-authorization checkers, then repeat the proven compatible readers/writers → optional schema → backfill → verify → tighten sequence. Keep the snapshot as a rollback artifact; restoring it with the pinned CLI and `--replace --prod` loses post-snapshot writes.
8. CLEAN UP: the preview auto-expires; securely delete the local snapshot when done and never commit it.

## Rules

- Create the preview from the PRE-CHANGE code and seed the snapshot BEFORE editing schema.ts — so the import conforms and the conformance gate then fails on the copy (not prod) when you push the change; each preview push is `deploy --preview-name`, import targets it with `--deployment`.
- Follow the migrate order every time: optional field → push → backfill → verify → tighten → push; skipping 'optional first' makes the very first push reject existing rows.
- The prod promote needs target reclassification, fresh explicit yes at the production action boundary, and both repository production checks; it repeats the proven preview run.
- Keep the prod snapshot as the rollback artifact; state plainly that a snapshot-restore loses data written after the snapshot, so keep the promote window short.
- Treat the exported snapshot as sensitive real data: delete it locally when finished; never commit it.
- Backfills go through @convex-dev/migrations (batched, resumable, dry-runnable), not ad-hoc one-shot mutations over a whole table.
- This is the rehearsal-and-promote flow; for the plain 'explain optional-then-tighten' guidance with no live data, that's migrate.
