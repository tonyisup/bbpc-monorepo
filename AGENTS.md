# BBPC monorepo guidance

- Use Node.js 22 or newer and manage dependencies from the repository root with pnpm
  workspaces. Do not create workspace-local lockfiles.
- Keep the three applications independently deployable. Shared application code should
  become an explicit package rather than a cross-app relative import.
- Before changing anything under `packages/convex-backend/convex`, read
  `packages/convex-backend/convex/_generated/ai/guidelines.md` in full.
- Before changing the Next.js 16 recording app, read the relevant installed guide under
  its `node_modules/next/dist/docs/` directory.
- Never commit environment values, deploy keys, production-derived rows, migration
  archives, or recording session data.
- Do not weaken the Convex target and environment checks. A production backend deploy
  still requires its separate approval and runbook.
- During local rollout only, the ignored sibling repositories are rollback sources.
  Make monorepo changes under `apps/` and `packages/`.
