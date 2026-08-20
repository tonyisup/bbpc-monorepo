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

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
