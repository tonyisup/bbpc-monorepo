# Episode search

Shared listener/admin metadata matching, transcript request state, and result merging.
Each app supplies its own authorized catalog and transcript transport, and renders
results with its own components. Metadata uses the listener's Fuse settings, with
literal substring matching when close spellings are disabled. Transcript requests
are debounced, validated, and discarded when their query is no longer current.

Pass a stable (module-level or `useCallback`) transport to `useTranscriptSearch`.
The transport receives an `AbortSignal`; transports that cannot cancel requests
still have late responses suppressed by the hook.

Run `pnpm --filter @bbpc/episode-search check` from the repository root. Both apps'
behavior suites cover transcript requests and rendering through this package.
