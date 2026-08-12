# Season date column migration

The Prisma schema now models `Season.startedOn` and `Season.endedOn` as SQL Server `DATE` columns.

Apply [`../prisma/manual-migrations/20260317_season_date_columns.sql`](../prisma/manual-migrations/20260317_season_date_columns.sql) during deployment before rolling out code that depends on the new schema shape.

Deployment notes:

- The script creates a one-time backup table named `dbo.Season_backup_20260317` before modifying `dbo.Season`.
- Existing `DATETIME` values are truncated to their calendar date with `CAST(... AS DATE)`. Any time-of-day component is intentionally discarded.
- The migration is wrapped in a transaction and is a no-op when the columns are already `DATE`.
- Rollback should restore the saved rows from `dbo.Season_backup_20260317` into `dbo.Season` if you need to recover the original timestamps.
