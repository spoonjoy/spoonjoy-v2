# Unit 2.2a Red Evidence

**Test commit**: `544358d0`

## Contract

- The exact ordered numeric 0000-0024 inventory is frozen, including both 0020 migrations, and the target must be the sole numeric 0025 migration.
- Empty and pre-feature fixture databases execute through real `better-sqlite3` transactions with foreign keys enabled.
- Complete normalized table, index, trigger, and view definitions prevent destructive or unauthorized schema/projection changes while reserving only the documented Unit 2.3 shopping-index replacement.
- Existing User, Recipe, Cookbook, and RecipeInCookbook rows are byte-shape snapshotted; migration may append only null Recipe.course, zero initial RecipeTag rows, and the exact four SavedRecipe rows.
- Mixed numeric/text timestamp normalization covers integer, half-away-from-zero real, min/max, negative values, all five grammars, both offset signs with and without milliseconds, nonzero offset minutes, normalized-before-dedup ordering, and invalid duplicate fail-closed behavior.
- Invalid ranges, non-finite values, malformed grammar, impossible dates, clock overflow, offset overflow, and normalized year overflow must roll back every product schema object and preserve source rows.
- Exact SavedRecipe canonical CHECK, PK/unique/FK/cascade behavior, exact two membership fences, enclosing transaction rollback, post-fence independence, and soft/hard recipe deletion are executable assertions.
- Shopping reconciliation, migration clock, and active-identity index behavior remain reserved for Unit 2.3.

## Red Run

`pnpm exec vitest run test/scripts/migration-0025-clem-feedback-product.test.ts`

- 45 tests collected.
- 44 intended failures are attributable to absent `migrations/0025_clem_feedback_product.sql` and its absent schema/backfill behavior.
- One passing case documents that `better-sqlite3` binds NaN as NULL, so the baseline NOT NULL source column rejects it before migration evaluation; stored positive/negative infinities remain migration cases.
- No implementation or migration file existed in the test commit.

## Review

Six cold-review rounds closed baseline-shadowing, incomplete offset grammar, destructive schema/data false positives, name-only schema comparisons, table-level constraint gaps, and view/projection inventory gaps. Final review returned `CONVERGED` with no remaining blocker or major finding.
