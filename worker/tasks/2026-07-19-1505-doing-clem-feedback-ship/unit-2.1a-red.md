# Unit 2.1a Red Evidence

**Command**: `pnpm exec vitest run test/models/clem-feedback-schema.test.ts test/lib/spoonjoy-api-import.test.ts test/docs/developer-platform-docs.test.ts test/lib/mcp/spoonjoy-tools.server.test.ts test/lib/shopping-list-mutations.server.test.ts --fileParallelism=false`

**Result**: expected failure; 104 tests passed and seven product-contract assertions failed.

- Four schema failures: nullable `Recipe.course` plus relations/index absent, `SavedRecipe` absent, `RecipeTag` absent, and the legacy full shopping identity `@@unique` still present.
- Two legacy import failures: persisted and dry-run results still pass through injected current/future schema fields.
- One documentation failure: the three named guides do not yet freeze the legacy agent/API versus MCP/UI boundary.
- Existing MCP exclusion and active-first/tombstone-aware compatibility writer suites remained green.

No implementation, Prisma generation, schema migration, or D1 state changed during this phase.
