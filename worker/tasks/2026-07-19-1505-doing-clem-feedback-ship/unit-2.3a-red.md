# Unit 2.3a Red Evidence

## Contract surface

- Migration tests freeze the exact `_Migration0025Clock` DDL, one static clock expression, insert/drop lifecycle, name-collision rollback, exact legacy-index drop, exact active partial expression index, setup-only `IF NOT EXISTS`, and executable Unit 3 conflict target.
- Fixtures cover sort-index and SQLite-BINARY survivor order; negative, all-null, mixed, maximum-finite, invalid-source, and positive/negative aggregate-overflow quantities; exact `checked = 1` behavior for non-boolean legacy values; survivor and fallback metadata; extra-row preservation; same-identity and unrelated existing-tombstone immutability; and null/empty/arbitrary-unit discriminator separation.
- Owner high-water fixtures cover User, owned active Recipe, Cookbook, NativeSyncTombstone, ShoppingList, active item, and deleted item timestamps. Every family has an owned high-water case, a foreign-owner isolation case, and an owned malformed-value rollback case; numeric-real truncation, deleted-recipe exclusion, non-finite values, and maximum-cursor overflow are separate regressions.
- The real Workers harness now applies 0000-0024, seeds compatibility data, applies 0025, and requires the migration-provided active identity index. With both cutover fences installed, it runs all six exact web, REST, and shared agent/MCP writers against active-plus-tombstone and tombstone-only identities. Expected Prisma-D1 diagnostics are asserted by token.

## Reproduced red

- `pnpm vitest run test/scripts/migration-0025-clem-feedback-product.test.ts --reporter=dot`: 47 pass, 37 intentional failures. Every failure is an absent clock/repair/index/high-water/fail-closed behavior.
- `pnpm vitest run --config vitest.workers.config.ts test/workers/saved-recipe-cutover-d1.test.ts --reporter=dot`: 12 pass, two intentional failures because 0025 still leaves the legacy full identity index instead of the active expression index.
- Five exact web, REST, shared agent/MCP, and seed compatibility files: 157/157 pass.
- `pnpm typecheck`: pass with no warnings.

No migration, setup-index implementation, product route, import UI, or Pebble-specific code changed in this unit.
