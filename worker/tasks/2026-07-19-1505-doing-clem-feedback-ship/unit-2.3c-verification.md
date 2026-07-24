# Unit 2.3c Verification

**Verified source**: `9c02616f627e42c5ff4d0d8bf3661b0dfc46e705`
**Migration SHA-256**: `151009d5410997365ec56c249a50c75b7aeecadd0841b677f1b0bd7a9ab2c6e6`

## Fresh Node SQLite

- Created independent file-backed success and forced-failure databases in a new temporary root.
- Applied the exact 25 numeric migrations through 0024 transactionally, then loaded the frozen pre-feature fixture with three active null-unit duplicates.
- A pre-existing `_Migration0025Clock` made final 0025 fail. The enclosing transaction rolled back every earlier 0025 statement: `SavedRecipe` remained absent, all three active fixture rows remained active, the sentinel clock row remained intact, and foreign-key checks stayed clean.
- A second fresh database applied exact 0025 successfully. `item-b` survived at sort index 1 with quantity 3, unchecked state, and null `checkedAt`; `item-a` and `item-c` became tombstones using the same captured clock as every repaired row.
- The helper clock and legacy full index were absent, the exact active partial expression index was present, and four saves, five memberships, zero tags, three null courses, two fences, and zero foreign-key violations remained.
- A second active identity was rejected by the named expression index; a same-identity tombstone was accepted and then removed.

## Fresh Wrangler D1

- Created an isolated Wrangler 4.90 migration directory and persistence root, applied exact 0000-0024 through the warning gate, verified no pending baseline migration, and loaded the fixture with only its outer transaction removed so Wrangler owned transaction boundaries.
- Added a sentinel `_Migration0025Clock`, staged exact 0025, and verified it appeared pending. The apply failed on the collision; Wrangler rolled the migration back, retained the sentinel, left all three fixture rows active, created no `SavedRecipe` table, and continued listing 0025 as pending.
- Removed the sentinel and applied 0025 exactly once. The first list, second apply, and second list each reported no migrations to apply.
- D1 matched Node's repaired shopping rows and product summary: four saves, five memberships, zero tags/non-null courses, no clock table, one active index, no legacy index, two fences, and zero foreign-key violations.
- D1 rejected a second active identity, accepted a same-identity tombstone, and retained no probe rows.

## Compatibility And Cleanup

- Replayed the complete preserved compatibility source after migration: six files and 169/169 tests passed across the mutation selector, seed, web, REST mutation, REST sync, and shared agent/MCP surfaces. This is the prior 168-test matrix plus the new post-commit-read idempotency regression.
- The rehearsal created 41 temporary files/directories, deleted the complete root in `finally`, proved the root no longer existed, and deleted the throwaway harness. A broad `spoonjoy-unit-2.3c-*` search returned no residue.
- A cold reviewer independently inspected and reran the harness, checked source/worktree cleanliness and cleanup, and returned `CONVERGED` with no finding.

No remote D1 state, import UI, cook-state model, or Pebble-specific work was touched.
