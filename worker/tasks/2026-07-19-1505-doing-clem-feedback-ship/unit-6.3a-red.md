# Unit 6.3a Red Evidence

Verified 2026-07-23.

Commit `bebcc501` freezes the recipe discovery filter contract across the two route and two service test surfaces without changing production code.

## Contract Coverage

- My Recipes decodes `+` and `%20` spaces identically, validates the exact course vocabulary, rejects category-C and empty tags, rejects more than ten raw tag parameters before deduplication, and accepts zero-padded positive pages while rejecting nonnumeric, zero, negative, fractional, and unsafe pages before issuing an offset.
- My Recipes service tests require NFKC normalization, locale-independent lowercase identities, first-occurrence deduplication, a direct canonical Recipe course predicate, one `RecipeTag.normalizedLabel` `EXISTS` per tag, AND semantics, pre-pagination filtering, and canonical `q`, `course`, repeated `tag`, `page` URL order.
- Global search rejects unknown scopes and forged recipe filters on cookbook, chef, and shopping-list scopes. All and recipe scopes preserve filters in canonical `scope`, `q`, `course`, repeated `tag` order; non-recipe scope links clear them.
- Global SQL must join the active canonical Recipe row, use one canonical tag `EXISTS` per normalized identity, preserve first-occurrence bind order, avoid SearchDocument metadata as predicate authority, and apply recipe-only filters before the 30-result limit. A tampered display-metadata counterexample and 31 newer decoys make the authority and pre-limit assertions non-vacuous.
- Both UIs require accessible course and tag controls, visible active filter values, and clear-filter links that preserve the text query. Non-recipe global scopes must not render recipe controls.
- Existing SearchDocument display and freshness tests remain green and continue to govern metadata as a projection only.

## Red Run

```text
npx vitest run test/lib/my-recipes-search.server.test.ts test/routes/my-recipes.test.tsx test/lib/search.server.test.ts test/routes/search.test.tsx --no-file-parallelism
```

Result: 42 existing tests passed and 24 contract tests failed across 66 tests. Every failure is attributable to absent course/tag parsing, validation, canonical SQL predicates, scope semantics, URL preservation, or accessible filter controls. The valid zero-padded-page contract already passes against the pre-existing service normalizer.

## Boundary

`test/config/clem-feedback-boundaries.test.ts` passes 9/9 after advancing only the four reviewed test hashes in the exact-content allowlist. A fresh self-audit strengthened the global SQL-shape proof and unsafe-page matrix. Independent sub-agent review could not start because the required session checkpoint rejects the currently invalid GitHub credential; no reviewer convergence is claimed for this red-only unit.
