# Unit 4.1 Verification

## Implementation

- Final implementation under review: `50413dfd`.
- REST recipe list/detail and MCP `get_recipe`/`search_recipes` use read-only metadata wrappers; the base REST and MCP serializers remain unchanged.
- Persisted `course` and display tag labels are public neutral metadata. No read surface exposes `isSaved` or other personalized save state.
- Tag display ordering uses canonical `normalizedLabel + NUL + id` sort keys and JavaScript's default UTF-16 code-unit ordering. The persisted normalization contract excludes category-C characters, so the separator cannot collide with a normalized label; recipe-tag IDs are unique.
- Search documents contain the neutral fields only on recipe metadata. Search freshness hashes fixed-key active Recipe and RecipeTag rows, including course, display label, normalized label, and canonical timestamps, so same-timestamp substitutions rebuild the index.
- OpenAPI has separate closed `RecipeReadSummary`/`RecipeReadDetail` components reachable only from the two public recipe GETs and four closed type-specific generic-search metadata branches.
- Mutation, recovery, native sync, cookbook, import, and MCP-write responses remain on the original base recipe serializers and schemas.

## Focused Gates

- The final Unit 4.1 matrix passed 235/235 tests across 13 files.
- The complete mutation, recovery, native, cookbook, and import preservation matrix passed 95/95 before the public-read assertion was deliberately upgraded; focused preservation passed 8/8 afterward.
- The summary-query projection regression proves list reads select `course` and tag display fields without loading detail relations.
- REST, MCP, indexed-search, null/empty, privacy, same-timestamp freshness, and non-ASCII code-unit counterexamples all pass.
- Two consecutive playground generations produced SHA-256 `bedde2e1450c39db00fd29658c6b498431c3bee571c5962faef26510fb6c7ef2`.
- Typecheck and the final production client/SSR build passed warning-clean.

## Full Gate

- App suite: 384 files and 9,205 tests passed with zero warning output in an isolated serial run.
- App coverage: 20,942/20,942 statements, 16,947/16,947 branches, 4,051/4,051 functions, and 19,248/19,248 lines (100% each).
- The worktree remained clean after the final generation, typecheck, coverage, and build gates.

## Test Hardening During Green-Up

- `cedd143f` changed a stale two-position search-example assertion to preserve its recipe/shopping checks while allowing the reviewed four-type catalog.
- `591fc93a` made cookbook-removal example validation nonvacuous by requiring a remaining base-shaped recipe and proving the removed recipe is absent.
- `cf9225b2` updated the summary-only query fixture and select assertion for the new lightweight metadata projection.
- `4d0bf1ab` replaced unreachable handwritten comparator branches with the canonical built-in code-unit sort, restoring exact branch coverage without suppressions.

## Cold Review

Galileo's first fresh review found three issues that the focused matrix had not exposed:

- all-row Recipe count/latest signals had been narrowed to active recipes, allowing a hard-deleted soft recipe to leave chef `recipeCount` stale;
- generic search declared its `type` and metadata union independently, so OpenAPI allowed cross-type metadata pairings; and
- the shared base detail loader selected course/tags for native, mutation, import, and recovery hydration even though those serializers discarded the fields.

Commit `5cca617f` froze one red regression for each finding. Commit `50413dfd` restored all-row Recipe baseline signals while retaining active-only metadata hashes, made `SearchResult` a four-branch discriminator union, and split base detail hydration from the public read-detail projection.

Fresh follow-up reviewer Hubble returned `CONVERGED` with no findings. Static inspection confirmed the repaired freshness populations, exact closed type/metadata pairings across full and SDK profiles, intentional connector pruning, and course/tag hydration only on public recipe detail. The 49-test reviewer matrix, typecheck, isolated 9,205-test exact-coverage run, and production build independently passed after the repair.
