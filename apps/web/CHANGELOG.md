# Changelog

All notable changes to the BBPC web app are documented in this file.

## [0.3.0] - 2026-08-20

### Added

- Movie searches now suggest the `y:year` release-year filter after a short delay when results are available and immediately when no movies are found.
- A no-result search ending in a year, such as `Imposter (2001)`, can convert that year into the release-year filter and rerun the search in one action.

## [0.2.0] - 2026-08-20

### Added

- Listeners now receive an advisory warning while entering a Quotabunga when a similar quote may have been submitted before. The warning never blocks submission.

### Changed

- Duplicate checks refresh while the form remains open, and the form clearly says when checking is temporarily unavailable instead of treating the result as clear.
