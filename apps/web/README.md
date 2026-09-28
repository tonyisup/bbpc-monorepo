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

Quotabunga's optional inline video search uses `YOUTUBE_API_KEY` in
`apps/web/.env.local`. Enable YouTube Data API v3 for that key's Google Cloud
project and restrict the key to that API. Use a key suitable for server requests;
a browser HTTP-referrer restriction will reject the server call. Keep the key
server-only (never use a `NEXT_PUBLIC_` prefix). The search route requires a Clerk
session, returns six embeddable videos per page, and caches provider responses for
five minutes. Each search first spends from the listener's search budget in Convex
(`games.quotes.reserveVideoSearch`); past the budget the route returns 429 with
`Retry-After`. If search is unavailable, listeners can still paste a clip link.

Set the same server-side variable in the web deployment environment when deploying
this feature. It is optional, so environments without video search still start.
Deploy the backend with `reserveVideoSearch` first; until then, search fails closed
as unavailable.

The Quote Finder's optional **Find it for me** assistant also needs a paid-tier
`GEMINI_API_KEY`, server-only like the YouTube key. Without either key the finder
looks and works as before. The assistant reuses the finder's search results (or runs
the search), then posts the quote, source and up to six video IDs to
`/api/quote-finder/locate`. Each call spends one run from the listener's assistant
budget in Convex (`games.quotes.reserveQuoteLocate`), checks one public, embeddable
video of at most three minutes with Gemini, and returns a padded range and the heard
line for the listener to preview. Nothing is submitted for them. Keep the Google
project prepaid with auto-reload off: an empty balance makes Gemini answer HTTP 402,
and the route then reports the assistant as out of budget. See
`docs/designs/quote-finder-assistant.md` for the budget. Deploy the backend with
`reserveQuoteLocate` before setting the key; until then, the assistant fails closed
as unavailable. Set the key for Production only: each Convex deployment keeps its own
assistant budget, so a key shared with Preview would let both draw on the one prepaid
balance.

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
