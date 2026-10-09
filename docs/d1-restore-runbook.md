# D1 backup and restore runbook

Spoonjoy's production data is one Cloudflare D1 database, `spoonjoy` (binding `DB` in `wrangler.json`). This page covers how to restore it after a bad migration, a bad job or a bad write. Read it before you restore, because a restore discards every write after the restore point, and nothing undoes that except restoring again.

## What exists

- **D1 Time Travel.** Cloudflare keeps a point-in-time history of the database. You can restore to a bookmark or to a timestamp. Retention depends on the account's plan; `wrangler d1 time-travel restore --help` accepts timestamps "within the last 30 days", and the Free plan keeps less. Check the account's plan before you rely on an old timestamp.
- **A restore point before every production migration.** `scripts/deploy-production-canary.ts` reads the database's Time Travel bookmark before it applies reviewed migrations. It prints `D1 restore point before migrations: <bookmark>` in the deploy log and records the same value as `preMigrationBookmark` in the release artifact, `mcp-oauth-canary-artifacts/production-release.json`. If the bookmark cannot be read, the release stops before migrating. The release never restores the database itself.
- **A logical export, `scripts/d1-logical-export.mjs`.** `wrangler d1 export` refuses this database because the search index, `SearchDocument`, is an FTS5 virtual table (migration 0006). The script exports every other table. It adds the indexes and triggers that `wrangler d1 export --table` leaves out, and it writes rows parents first, because a remote D1 import fails with `{"D1_RESET_DO":true}` when a row arrives before the row its foreign key references. The search index is derived data: after a restore, the app rebuilds it on the first search.

## Choose the restore

1. **A migration damaged data, and production has had few writes since.** Restore to the release's `preMigrationBookmark`. Every write after the migration started is lost.
2. **A job or bad write damaged data at a known time.** Restore to a timestamp just before it, using `--timestamp`. Every write after that time is lost.
3. **Time Travel cannot reach the point you need,** for example because it is past retention or the database was deleted. Load the newest logical export into a new D1 database and point the `DB` binding at it.

If only a few rows are wrong, consider repairing them with a reviewed, reversible migration instead. That keeps everyone else's writes.

## Before you restore

- Get the decision from the person who owns production data (Ari). A production restore discards real users' writes.
- Record the current bookmark, `pnpm exec wrangler d1 time-travel info DB --json`. This is your undo point; `restore` also prints it.
- Stop the cause. Roll back the Worker, or disable the job, first, so it does not damage the restored data again.

## Restore with Time Travel

```sh
pnpm exec wrangler d1 time-travel info DB --json            # current bookmark, your undo point
pnpm exec wrangler d1 time-travel restore DB --bookmark <preMigrationBookmark>
# or: pnpm exec wrangler d1 time-travel restore DB --timestamp 2026-10-09T11:06:00Z
```

Then verify. Run `PRAGMA foreign_key_check;` (it should return no rows), compare row counts for `User`, `Recipe`, `RecipeStep` and `Ingredient` with what you expect, and check `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3`. After restoring to a pre-migration bookmark, the migrations are pending again. Fix or revert them before the next deploy applies them a second time.

## Take and restore a logical export

```sh
node scripts/d1-logical-export.mjs --target production --output /secure/path/spoonjoy-$(date -u +%Y%m%dT%H%M%SZ).sql
```

The export holds user data and credential hashes. Store it encrypted, never in Git, and keep it off shared machines. To restore, create an empty D1 database and load the file with `pnpm exec wrangler d1 execute <new-db> --remote --file <export.sql>`. Then point the `DB` binding in `wrangler.json` at the new database and deploy through the normal release, which needs a reviewed PR. While an export runs it reads the whole database, so run it at a quiet time.

## Rehearsal, 2026-10-09

The rehearsal ran on a scratch D1 database, which was deleted afterwards. A QA export was loaded into it, then damaged and restored.

| Path | Restore time | Data lost (RPO) |
| --- | --- | --- |
| Time Travel to a bookmark | 6 s for the restore, about 20 s to verified counts | Every write after the bookmark |
| Logical export into an empty D1 | 3 s for QA's 2,117 statements (1.2 MB), plus creating the database and redeploying the binding | Everything since the export was taken |

Both restores matched the source row counts exactly and kept all 97 indexes and the one trigger. `PRAGMA foreign_key_check` returned no rows.
