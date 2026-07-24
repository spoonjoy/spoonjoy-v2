# Unit 6.4a Red Evidence

## Frozen Surface

Unit 6.4a adds persisted integration contracts only for the three named web read surfaces:

- Recipe detail must return and render neutral `course` plus deterministic string `tags`.
- My Recipes must project and render the same metadata on each owned recipe card.
- Global search must render existing neutral recipe-result metadata without adding it to cookbook cards.

Each test persists a target and a decoy recipe with different course/tags, loads both independently, and scopes semantic `Recipe metadata` and `Recipe tags` assertions to each recipe. A global or cross-recipe metadata lookup cannot satisfy the matrix. Persisted saved rows prove the read projections do not acquire `isSaved`; categorization-source keys are also rejected without changing existing web save controls or cover provenance.

REST and MCP serializers remain untouched and are not red targets.

## Red Commands

Targeted contract:

```sh
npx vitest run test/routes/recipes-id.test.tsx test/routes/my-recipes.test.tsx test/routes/search.test.tsx --no-file-parallelism -t "persisted neutral|neutral recipe metadata"
```

Result: three files fail with exactly one intended feature failure each. Recipe detail lacks persisted tags, My Recipes lacks course/tag projection, and global recipe cards lack semantic metadata rendering.

Compatibility lane:

```sh
npx vitest run test/routes/recipes-id.test.tsx test/routes/my-recipes.test.tsx test/routes/search.test.tsx --no-file-parallelism
```

Result: 3 intended failures and 181 passing surrounding tests across 184 tests. No production file changed.

## Review

The first harsh review blocked the single-recipe fixtures because one global tag set could satisfy all three. Round 2 accepted the repaired My Recipes and global-search target/decoy projections but found recipe detail still loaded only one ID. Round 3 rechecked independent target/decoy loader calls and renders on every surface and returned `CONVERGED`.
