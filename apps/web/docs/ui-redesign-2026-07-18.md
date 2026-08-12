# BBPC UI Redesign and Tags Retirement

Date: 2026-07-18
Branch: `audit/taste-ui`

## Scope

This implementation applies the approved design-taste audit to the shared application shell and the Home, History, Game, Year, and About pages. The Tags feature is retired completely.

## Architecture decisions

### Tags retirement

- Removed every route under `src/app/tags`, including all former `/tags/*` descendants.
- Removed the Tags navigation item.
- Removed tag-only UI components.
- Removed the tag tRPC router and its root registration.
- Added explicit permanent redirects from `/tags` and `/tags/:path*` to `/history` in `next.config.mjs` so old inbound links resolve to the supported archive experience.
- Preserved database models and historical data. Retiring the user-facing feature does not require a destructive schema migration.

### Shared visual system

- `src/styles/globals.css` now defines semantic BBPC background, surface, border, text, muted, and accent tokens.
- `SiteHeader` owns the shared wordmark, navigation, active-route state, and voice-message action.
- The voice action remains reachable at mobile widths and has an explicit accessible name.
- Full text navigation begins at the `xl` breakpoint; narrower tablet layouts retain the named menu trigger so authenticated navigation cannot collide with the logo and voice action.
- User zoom remains enabled, and layout containment is fixed at the component level without global overflow clipping.
- `ListenHere` uses one consistent link treatment and Simple Icons brand marks from `react-icons`.

### Home and participation

- Home now has explicit `Latest episode` and `Up next` hierarchy.
- The first above-the-fold movie poster is marked as a priority image.
- Episode cards use bounded responsive grids and horizontal poster overflow only where the content is intentionally scrollable.
- `GameParticipation` owns the unauthenticated game state, producing one sign-in action for rating predictions and Quotabunga.

### Game

- The current round is presented before season analytics.
- Season standings are deferred until the disclosure is opened. This avoids rendering a responsive chart inside a zero-width hidden container.
- Rules are grouped into semantic disclosures instead of a wall of equal cards.
- The grouped gambling reference retains the 1x, 2x, and 3x multipliers, payout calculation, voice-only Bonus Harley rule, and retired-format note.
- The retired tag-voting rule was removed.

### Year in review

- Duplicate movie rows are grouped by movie ID into one poster card with persistent host, rating, and deduplicated episode metadata.
- Essential metadata no longer depends on hover.
- Public sessions no longer call the protected `auth.isAdmin` procedure. The query is enabled only for authenticated sessions.
- The first poster is marked as a priority image.

### About and History

- Removed the public AI-generation disclaimer from About.
- Rewrote the story into a concise origin narrative using the existing BBPC host illustration.
- History now explains close-spelling search, provides a useful default state, and keeps the archive link visible.

## Verification

The implementation was verified with:

```text
npm test
npx tsc --noEmit
npm run build
npx next lint --file <every changed TypeScript/TSX file>
git diff --check
```

Runtime verification covered:

- Desktop Home, Game, Year, About, and History routes.
- True 320 by 812 and 375 by 812 device emulation through Chrome DevTools Protocol.
- DOM overflow measurements at the emulated viewport.
- Header breakpoint checks at 768, 1024, and 1280 pixels.
- Browser console inspection.
- Permanent redirects for both `/tags` and a representative `/tags/action` descendant.

The full repository lint command still reports unrelated pre-existing `react/no-unescaped-entities` failures outside this change set. Targeted linting for all changed TypeScript and TSX files exits successfully with no warnings or errors.
