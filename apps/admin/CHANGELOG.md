# Changelog

All notable changes to BBPC Admin are documented in this file.

## [0.2.0.0] - 2026-08-20

### Added

- Movie searches now suggest the `y:year` release-year filter after a short delay when results are available and immediately when no movies are found.
- A no-result search ending in a year, such as `Imposter (2001)`, can convert that year into the release-year filter and rerun the search in one action.

## [0.1.0.0] - 2026-08-10

### Fixed

- The `/record` page now matches `/quotabunga` by choosing the `next` episode first, then a `recording` episode, then the newest available episode, so the latest Quotabunga entries remain visible when an older episode is still marked as recording.
