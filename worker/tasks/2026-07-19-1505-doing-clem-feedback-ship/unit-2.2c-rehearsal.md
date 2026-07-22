# Unit 2.2c Rehearsal

**Migration commit**: `bb8e0bb0`
**Migration SHA-256**: `8c3990228e4473f88cd902df35a036dc266c53e4b5fdf9a8b60b94b63da4e225`

## Node SQLite

- Created a new temporary file-backed `better-sqlite3` database.
- Applied the exact 25 numeric migrations from 0000 through 0024 transactionally, loaded the frozen pre-feature fixture, and applied committed 0025 transactionally.
- Observed the exact four canonical SavedRecipe rows, zero tags, three null courses, five memberships, three untouched shopping rows, both named fences, only Cookbook and RecipeInCookbook as cook-named tables, and zero foreign-key violations.
- Proved one temporary database file existed, deleted the temporary root, and proved the root no longer existed.

## Wrangler D1

- Created a new isolated Wrangler 4.90 local D1 persistence root.
- Applied the exact 25 baseline SQL files through warning-gated `wrangler d1 execute` calls, loaded a temporary fixture copy with only its D1-unsupported outer `BEGIN IMMEDIATE`/`COMMIT` removed, and applied the exact committed 0025 file.
- The first isolated attempt rejected the fixture's explicit transaction before 0025 executed; its `finally` cleanup deleted that state. The corrected fresh replay delegated transaction ownership to Wrangler and succeeded.
- D1 returned the same four save keys/timestamps, zero tags/non-null courses, five memberships, three shopping rows, exact two fences, exact cook-table allowlist, and zero foreign-key violations as Node SQLite.
- Proved 11 isolated persistence/fixture entries existed, deleted the temporary root, and proved the root no longer existed.

## Compatibility Review

- Replayed all 168 pre-product compatibility tests across web, REST, native sync, shared agent/MCP, and seed after the committed migration.
- Additive product schema remains readable by the prior Worker, while the exact membership insert/delete fences continue to map through its already-deployed retryable activation path.
- No Unit 2.3 shopping repair, migration-clock, or partial-index claim is included.
- Fresh verification review returned `CONVERGED` with no blocker or major finding.
