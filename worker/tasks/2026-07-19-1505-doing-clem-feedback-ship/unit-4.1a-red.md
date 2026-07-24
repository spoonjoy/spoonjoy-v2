# Unit 4.1a Red Evidence: Neutral Recipe Metadata

## Frozen Matrix

Command:

```bash
pnpm exec vitest run \
  test/routes/api-v1-recipes.test.ts \
  test/lib/mcp/spoonjoy-tools.server.test.ts \
  test/routes/api-v1-search.test.ts \
  test/lib/search.server.test.ts \
  test/lib/api-v1-openapi.server.test.ts \
  test/config/recipe-read-metadata-boundaries.test.ts \
  test/routes/api-v1-native-sync.test.ts \
  test/routes/api-v1-recipe-writes.test.ts \
  test/routes/api-v1-recipe-steps.test.ts \
  test/routes/api-v1-recipe-import.test.ts \
  test/routes/api-v1-cookbooks.test.ts \
  test/lib/spoonjoy-api-import.test.ts \
  test/scripts/generate-api-playground.test.ts \
  --maxWorkers=1
```

Result: `7` files failed, `6` files passed; `29` tests failed, `204` tests passed (`233` total).

The failures are the expected pre-implementation contract gaps:

- REST recipe list/detail reads do not yet expose neutral `course` and UTF-16-code-unit-ordered `tags`.
- MCP `get_recipe` and `search_recipes` do not yet expose the neutral fields, and `search_spoonjoy` does not yet carry them through indexed recipe metadata.
- Search documents do not yet store the fields or fingerprint same-timestamp changes to recipe course and tag display/normalized labels.
- OpenAPI does not yet define or route exact read-only recipe schemas and exact type-specific search metadata branches.
- Generated examples and the two public API guides do not yet describe or demonstrate neutral read metadata without personalized save state.
- The existing public recipe-detail read exercised by the step suite still has the old read shape.
- The generated generic-search example does not yet cover exact non-recipe branches, and the generated cookbook-delete example is still vacuous for recipe-shape preservation.

## Compatibility Evidence

- The complete mutation, recovery, native sync, cookbook, and import preservation matrix passed `95/95` before the public-read assertion was deliberately upgraded.
- A focused preservation rerun passed `8/8` after metadata-bearing fixtures and exact key assertions were added.
- The step suite now has `17` passing compatibility tests and one expected public-read failure.
- The OpenAPI suite has `17` passing compatibility tests and four expected read/search-schema failures.
- `pnpm run typecheck` passed without warnings after the frozen test surface was assembled.
- API playground generation was run during test construction and produced no uncommitted generated artifact.

## Adversarial Review

Four fresh reviewer rounds examined scope isolation, exact wire compatibility, ordering counterexamples, fingerprint freshness, generated examples, documentation boundaries, and preservation coverage. Rounds one through three found and closed concrete gaps. The fourth cold review returned `CONVERGED` with no findings.
