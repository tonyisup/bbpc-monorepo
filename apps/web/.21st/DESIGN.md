# BBPC listener design context

The active stylesheet is `src/styles/globals.css`, imported by the app layout. The older `styles/globals.css` is not the source for these pages.

Use dark neutral surfaces, red accents, shared `bbpc-page` and `bbpc-panel` styles, and installed Radix-based components. Preserve visible focus, reduced motion, labeled controls, and honest saving/error states.

The syllabus uses compact numbered rows, readable notes, and collapsed assigned history. Game controls retain their comfortable touch targets. Quotabunga uses the same neutral surfaces and red accents. The listener game is one flat sheet of hairline-divided rows (`GameSheet`) rather than nested cards. Every movie's pick grid is open at once under a sticky rating legend, each movie's wagers are a summary line that opens the list of bets with a single Confirm, and Quotabunga is the sheet's last row, starting from **Add your quote**.

Token values and installed primitives are recorded in `design.json`.
