# Unit 2.3b Verification

**Implementation commit**: `7df3662f`

## Shopping Repair

- Migration 0025 creates one collision-failing `_Migration0025Clock`, captures one millisecond/text clock pair from the contract expression, uses it through the repair, and drops the helper before commit.
- Active rows reconcile deterministically by list, ingredient, and null-safe unit identity. The earliest sort index then SQLite-BINARY id survives; finite quantities, exact checked state, metadata fallback, fresh-end movement, and non-survivor tombstones follow the frozen product-data contract.
- Account-global owner high-water validation covers User, active Recipe, Cookbook, NativeSyncTombstone, ShoppingList, and ShoppingListItem timestamps. Invalid owned values and cursor overflow fail the whole migration.
- The legacy full unique index is dropped and replaced by the exact active partial expression index. Test setup installs the same index after row cleanup with only the permitted `IF NOT EXISTS` difference.

## Compatibility And Warning Hardening

- Every exact pre-product web, REST, shared agent/MCP, native-sync, and seed writer restores the active index after legacy fixture coverage.
- The real D1 six-writer matrix covers active-plus-tombstone and tombstone-only identities with both saved-recipe fences installed.
- Dynamic Prisma-D1 errors are owned by the centralized predicate matcher rather than test-local console overrides.
- Prisma's D1 transaction warning, which is emitted through `console.info`, now fails both installed Vitest lanes while ordinary informational output remains allowed and `console.info` overrides are prohibited.
- REST manual-item writes no longer request Prisma relational mutation includes. The response is hydrated from the committed row plus already-loaded relations, avoiding D1's ignored transaction facade without adding a post-commit read that could break idempotent replay.

## Verification

- Migration 0025 contract: 84/84 tests passed.
- All migration and affected writer files: 20 files and 318/318 tests passed.
- Warning-policy contract: 57/57 tests passed, including app and Workers installed-hook sentinels.
- Real Wrangler D1 compatibility harness: 14/14 tests passed with zero warning output.
- Full app coverage: 381 files and 8,373 tests passed; 100% statements (19,613/19,613), branches (15,479/15,479), functions (3,886/3,886), and lines (18,026/18,026).
- Workers coverage: 44/44 tests passed; 100% statements (37/37), branches (23/23), functions (5/5), and lines (37/37).
- Typecheck, production build, and `git diff --check` passed.

## Cold Review

- The migration/index reviewer independently reproduced 84 focused migration tests, 160 migration tests overall, 14 real-D1 tests, and diff hygiene, then returned `CONVERGED` with no finding.
- The warning/idempotency reviewer found one post-commit-read blocker and two warning-gate coverage gaps. Regression tests reproduced the read, all three findings were fixed, and the same reviewer returned `CONVERGED` on the final diff.

No import UI, cook-state D1 model, or Pebble-specific work was added.
