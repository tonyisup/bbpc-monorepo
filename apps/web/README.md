# BBPC web

The public site for [badboyspodcast.com](https://badboyspodcast.com), built with
Next.js 15, React 18, Clerk, Convex, and Tailwind CSS.

## Development

Install dependencies from the monorepo root and start the web workspace:

```sh
pnpm install --frozen-lockfile
pnpm run dev:web
```

Copy this app's `.env.example` to `.env.local` and provide the Clerk, Convex,
UploadThing, and other service credentials described there.

The app consumes the shared Convex client contract from the private
`@tonyisup/bbpc-convex-api` workspace package. Contract and backend changes can
therefore be tested atomically from the repository root with `pnpm run check`.

## Deployment

Keep the public site's existing Vercel project and configure its root directory as
`apps/web`. Preserve the project's current domains, environment variables, and
deployment protection.

## License

MIT License

Copyright (c) 2024 BBPC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
