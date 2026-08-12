# BBPC admin

The Clerk-authenticated administration application for BBPC's shared Convex backend,
built with Next.js 15, React 18, and Tailwind CSS.

## Development

Install dependencies from the monorepo root and start the admin workspace:

```sh
pnpm install --frozen-lockfile
pnpm run dev:admin
```

Copy this app's `.env.example` to `.env.local` and provide its Clerk, Convex, and
UploadThing credentials. Run the complete cross-workspace verification suite with
`pnpm run check` from the repository root.

Additional reference material:

- [Admin functionality](FUNCTIONALITY.md)
- [Authorization matrix](docs/AUTHORIZATION_MATRIX.md)

## Deployment

Keep the admin application's existing Vercel project and configure its root directory
as `apps/admin`. Preserve its current environment variables and deployment protection.
