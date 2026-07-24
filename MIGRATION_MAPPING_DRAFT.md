# SQL-to-Convex Mapping Draft

Status: **review required before production-derived transformation**

Source: the read-only `dev` clone census with schema fingerprint
`5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`.
The census declares `containsRowValues: false`; no production row values are copied here.
All 31 migrated targets and their minimum indexes are now defined in the Convex schema
and verified against the typed mapping. This does not approve or run the
production-derived transform.

The identity, catalog, and episode mappings are implemented as synthetic-only,
checkpointed rehearsal slices. Their guarded local extractors exist but have not been
run against the production-derived `dev` clone. Catalog rehearsal tests prove that
duplicate movie/show normalized keys remain distinct while tag collisions fail
transactionally. A separate catalog pass independently reconciles every transformed
field before marking that domain reconciled. Identity independently rechecks profiles,
normalized keys, derived permissions, and user-role relationships. Episodes
independently recheck normalized slug uniqueness, nullable relationships, calendar
dates, and external audio metadata before their domain is reconciled.

## Global conversion rules

| SQL shape | Convex representation | Rule |
|---|---|---|
| UUID primary key | `legacyId: string`, indexed | Lowercase UUID text; all runtime relationships use Convex IDs. |
| String primary key | `legacyId: string`, indexed | Preserve exactly; identity lookup never trusts email alone. |
| Integer identity | `legacyId: number`, indexed | Validate the original tinyint/smallint/int range. |
| `date` | `YYYY-MM-DD` string | Preserve calendar meaning without timezone conversion. |
| `datetime` / `datetime2` | UTC epoch milliseconds | Recommended: interpret the legacy wall-clock value as UTC, without adding a local-time offset. |
| Nullable scalar | optional field or explicit `null` | Decide per field; preserve SQL `NULL` distinctly from zero/empty text. |
| Case-insensitive key | display value plus `normalized*` field | Proposed: trim, Unicode NFKC, locale-independent lowercase. |
| SQL foreign key | Convex `Id<target>` | Resolve through the target table’s `legacyId` index. |
| SQL filtered/composite unique | lookup index plus mutation check | Enforce inside the same Convex transaction as the write. |

No SQL cascade is assumed automatically. Domain delete functions enumerate dependent
records, use bounded batches where necessary, and test the approved cascade/set-null
behavior.

## Table dispositions

The typed source of truth is
[`migration/schemaMapping.ts`](./migration/schemaMapping.ts). It covers all 34 census
tables exactly once and records the required index set for every migrated target.

| Domain | Source | Target/disposition | Special rule |
|---|---|---|---|
| archive | `Archive.Posts` | `archivePosts` | Preserve 433 rows; product visibility is pending. |
| identity | `dbo.Account` | retire | Do not extract provider credentials or tokens. |
| identity | `dbo.Session` | retire | Do not migrate session tokens; force Clerk sign-in. |
| identity | `dbo.VerificationToken` | retire | Do not migrate verification tokens. |
| identity | `dbo.User` | `users` | Preserve profile, verified-at timestamp, and legacy ID; active impersonation state is retired. |
| identity | `dbo.Role` | `roles` | Add normalized name and canonical permissions. |
| identity | `dbo.UserRole` | `userRoles` | Reject duplicate canonical user/role links. |
| episodes | `dbo.Episode` | `episodes` | Calendar date stays a string; nullable slug remains unique when present. |
| episodes | `dbo.Link` | `episodeLinks` | Preserve nullable episode relation. |
| episodes | `dbo.Banger` | `bangers` | Preserve nullable episode/user relations. |
| episodes | `dbo.AudioEpisodeMessage` | `episodeAudioMessages` | Metadata only; media stays external. |
| catalog | `dbo.Movie` | `movies` | Preserve duplicate titles/URLs and every legacy ID. |
| catalog | `dbo.Show` | `shows` | Preserve every row and legacy ID. |
| catalog | `dbo.Tag` | `tags` | Enforce normalized-name uniqueness. |
| assignments | `dbo.Assignment` | `assignments` | Preserve type, playable, owner, episode, movie, and slug. |
| assignments | `dbo.AudioMessage` | `assignmentAudioMessages` | Metadata only; media stays external. |
| assignments | `dbo.AssignmentPoints` | `assignmentPointLinks` | Preserve all three explicit relationships. |
| assignments | `dbo.Syllabus` | `syllabusEntries` | Preserve owner-scoped ordering. |
| reviews | `dbo.Rating` | `ratings` | Validate tinyint value and presentation metadata. |
| reviews | `dbo.Review` | `reviews` | Preserve both legacy timestamp fields pending precedence approval. |
| reviews | `dbo.AssignmentReview` | `assignmentReviews` | Preserve the join document. |
| reviews | `dbo.ExtraReview` | `extraReviews` | Preserve the join document. |
| games | `dbo.GameType` | `gameTypes` | Normalized lookup ID is unique. |
| games | `dbo.GamePointType` | `gamePointTypes` | Validate smallint points; normalized lookup ID is unique. |
| games | `dbo.Season` | `seasons` | Start/end are nullable calendar strings. |
| games | `dbo.Point` | `points` | Preserve `NULL` adjustment separately from `0`. |
| games | `dbo.Guess` | `guesses` | Correct the field spelling to `assignmentReviewId`. |
| games | `dbo.GamblingType` | `gamblingTypes` | Multiplier must be finite. |
| games | `dbo.GamblingPoints` | `gamblingEntries` | Preserve pending/resolved state and optional award links. |
| games | `dbo.TagVote` | `tagVotes` | Unresolved point UUID becomes `legacyAwardTombstone`. |
| games | `dbo.QuoteSubmission` | `quoteSubmissions` | Preserve checks and transactional uniqueness rules. |
| rankings | `dbo.RankedListType` | `rankedListTypes` | `maxItems` and `targetType` drive validation. |
| rankings | `dbo.RankedList` | `rankedLists` | Preserve owner/type/status/title/timestamps. |
| rankings | `dbo.RankedItem` | `rankedItems` | Validate the approved target shape and list ordering. |

## Read-only mapping-probe evidence

The local-only probe ran against the guarded database named exactly `dev`. It retained
aggregate counts and clock offsets only; it did not print or persist source-row values.

| Decision area | Aggregate evidence | Recommended mapping |
|---|---|---|
| SQL timestamps | Server offset `0`; `GETDATE()` minus `GETUTCDATE()` is `0` minutes. Azure SQL Database follows UTC according to [Microsoft's `GETDATE` documentation](https://learn.microsoft.com/en-us/sql/t-sql/functions/getdate-transact-sql?view=sql-server-ver17). | Interpret `datetime`/`datetime2` values as UTC and convert directly to epoch milliseconds. |
| Review timestamps | 989 rows: 341 both null, 120 `ReviewdOn` only, 0 `reviewedOn` only, 528 both equal, 0 conflicting. | `reviewedAt = reviewedOn ?? ReviewdOn`; preserve each source field in private reconciliation evidence, not in the canonical document. |
| Archive linkage | 433 rows: 327 linked to an episode, 106 unlinked, 0 unresolved episode references. | Migrate every row and preserve a nullable episode relation; product visibility remains a product choice. |
| Ranked-item targets | 19 rows: all 19 have exactly one of movie/show/episode; 0 have none or multiple. | Require exactly one target and validate it against the ranked-list type. |
| Ordering | 0 duplicate `(rankedListId, rank)` groups and 0 duplicate `(userId, order)` syllabus groups. | Enforce both keys transactionally in Convex. |
| Relationship joins | 0 duplicate user-role, assignment-review, or assignment-point relationship groups. | Preserve one canonical document per relationship and reject duplicates on future writes. |
| Normalized lookup keys | Every role (6), tag (7), game type (2), game-point type (14), and gambling type (8) remains distinct after SQL trim/lower normalization; no blanks. | Use the proposed Unicode-aware normalized key and fail transformation if it creates a collision. |
| Identity candidates | All 19 users have nonblank email; all 19 remain distinct after SQL trim/lower normalization; 0 duplicate normalized groups. | Preserve display email, store a normalized candidate key, and still require a verified Clerk email before first-use linking. |
| Legacy impersonation | 0 users have populated `impersonatedUserId`; 0 unresolved targets. | Do not copy the field; all future impersonation uses expiring audited sessions. |

## Initial index contract

Every migrated table receives `by_legacyId`. These are the additional minimum indexes
needed for relationship resolution, SQL parity, and the inventoried capability paths.
Index names include every indexed field.

| Target | Initial indexes beyond `by_legacyId` |
|---|---|
| `archivePosts` | `by_episodeId_and_postedAt` |
| `users` | `by_normalizedEmail`, `by_status` |
| `roles` | `by_normalizedName` |
| `userRoles` | `by_userId`, `by_roleId`, `by_userId_and_roleId` |
| `episodes` | `by_number`, `by_slug`, `by_normalizedSlug`, `by_date_and_status` |
| `episodeLinks`, `bangers`, `episodeAudioMessages` | `by_episodeId`; user-owned records also `by_userId` |
| `movies`, `shows` | `by_tmdbId` where applicable, `by_normalizedTitle_and_year` |
| `tags` | `by_normalizedName` |
| `assignments` | `by_userId`, `by_episodeId`, `by_movieId`, `by_slug` |
| `assignmentAudioMessages` | `by_assignmentId`, `by_userId` |
| `assignmentPointLinks` | `by_assignmentId`, `by_pointId`, `by_userId` |
| `syllabusEntries` | `by_userId_and_order`, `by_movieId`, `by_assignmentId` |
| `ratings` | `by_value` |
| `reviews` | `by_userId`, `by_movieId`, `by_showId`, `by_ratingId` |
| `assignmentReviews` | `by_assignmentId`, `by_reviewId` |
| `extraReviews` | `by_episodeId`, `by_reviewId` |
| `gameTypes`, `gamePointTypes`, `gamblingTypes` | `by_normalizedLookupId`; child types also `by_gameTypeId` |
| `seasons` | `by_gameTypeId`, `by_startedOn` |
| `points` | `by_userId`, `by_seasonId`, `by_gamePointTypeId`, `by_userId_and_seasonId` |
| `guesses` | `by_userId`, `by_assignmentReviewId`, `by_seasonId`, `by_pointId`, `by_userId_and_assignmentReviewId` |
| `gamblingEntries` | one index for each relation plus `by_userId_and_seasonId` |
| `tagVotes` | `by_userId`, `by_normalizedTag_and_userId`, `by_tmdbId_and_normalizedTag` |
| `quoteSubmissions` | `by_episodeId_and_status`, `by_episodeId_and_userId`, `by_seasonId`, `by_userId`, `by_pointId` |
| `rankedLists` | `by_userId`, `by_rankedListTypeId`, `by_userId_and_rankedListTypeId` |
| `rankedItems` | `by_rankedListId_and_rank`, plus one index for each nullable target |

All queries must use these indexes with `.unique()`, bounded `.take()`, or pagination.
Production-scale behavior tests may add indexes; they may not replace a measured query
with an unbounded scan.

## Approval items

1. Approve interpreting SQL `datetime`/`datetime2` as UTC.
2. Approve `reviewedAt = reviewedOn ?? ReviewdOn`.
3. Approve trim + Unicode NFKC + locale-independent lowercase, with collision detection.
4. Decide whether `Archive.Posts` remains queryable or backup-only after cutover.

The production-derived transformer remains blocked until these items and the Phase 0
anomaly/operation dispositions receive domain-owner sign-off.
