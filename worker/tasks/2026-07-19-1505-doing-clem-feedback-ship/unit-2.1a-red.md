# Unit 2.1a Red Evidence

**Command**: `pnpm exec vitest run test/models/clem-feedback-schema.test.ts test/lib/spoonjoy-api-import.test.ts test/docs/developer-platform-docs.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/lib/shopping-list-mutations.server.test.ts --fileParallelism=false`

**Result**: expected failure; 104 tests passed and seven product-contract assertions failed.

- Four schema failures: nullable `Recipe.course` plus relations/index absent, `SavedRecipe` absent, `RecipeTag` absent, and the legacy full shopping identity `@@unique` still present.
- Two legacy import failures: persisted and dry-run results still pass through injected current/future schema fields.
- One documentation failure: the three named guides do not yet freeze the legacy agent/API versus MCP/UI boundary.
- Existing MCP exclusion and the core active-first/tombstone-aware mutation selector remained green in the original red command.

## Cold-Review Repair

Two cold reviews found that the first test pass did not freeze nested persisted-import rows, exact complete model blocks, every possible cook-named Prisma/D1 table, coherent rendered guide copy, or the full Unit 1.9 adapter matrix. The repair added arbitrary unknown fields at every persisted relation depth and compares the serialized six-key envelope; compares exact normalized `SavedRecipe`, `RecipeTag`, and `ShoppingListItem` model lines; scans both Prisma models and numeric D1 migration `CREATE TABLE` declarations; and verifies one coherent boundary in each named guide plus rendered `/developers` output.

The strengthened red command produced three focused failures: nested import fields leaked, Claude connector copy still claimed the legacy HTTP API and MCP had the same tool surface, and one shared Markdown/render marker needed correction. Schema exactness and D1 cook-table absence already passed against the in-progress model implementation.

The complete preserved compatibility matrix then passed 168 tests across `shopping-list-mutations.server`, seed compatibility, web shopping-list routes, REST mutations, REST native sync, and shared agent/MCP tools.

No implementation, Prisma generation, schema migration, or D1 state changed during this phase.
