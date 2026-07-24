# Unit 6.1a Red Evidence

Verified 2026-07-23.

The recipe metadata storage contract is frozen in two deliberately red test surfaces:

- `test/lib/recipe-tags.server.test.ts` contains 1,221 lines covering the exact course enum/null contract; NFKC-first validation; Unicode Category C rejection before whitespace handling; native Unicode `White_Space` trim/collapse; `Array.from` code-point limits; argument-free default `toLowerCase` without renormalization; malformed collections; first-display-spelling deduplication; deterministic JavaScript UTF-16 ordering; public active-recipe reads; owner/active-only replacement; composable operation preparation; equivalent local Prisma raw-operation transactions; strict native batch result validation; rollback; and complete-state concurrency.
- `test/workers/recipe-tags-d1.test.ts` contains 362 lines using the isolated `cloudflare:test` pool and a real D1 binding. It freezes native batch rollback after a forced later-statement failure, unchanged Recipe/RecipeTag timestamps, concurrent replacement winner semantics, and observer states restricted to the complete old/A/B sets.

The service red command was:

```text
pnpm exec vitest run test/lib/recipe-tags.server.test.ts --fileParallelism=false
```

Result: one failed suite, zero tests collected, solely because `~/lib/recipe-tags.server` does not exist.

The isolated Workerd red command was:

```text
pnpm exec vitest run test/workers/recipe-tags-d1.test.ts --config vitest.workers.config.ts --maxWorkers=1 --no-isolate
```

Result: one failed suite, zero tests collected, solely because `../../app/lib/recipe-tags.server` does not exist.

## Atomicity Audit

The planning assumption that a Prisma transaction would protect production D1 mutations was rejected before implementation. The pinned `@prisma/adapter-d1@6.19.2` `startTransaction` implementation warns that implicit and explicit transactions are ignored and run as individual queries, breaking ACID guarantees. Cloudflare's documented `D1Database.batch()` contract executes the prepared statements as a SQL transaction and rolls back the sequence if a statement fails: <https://developers.cloudflare.com/d1/worker-api/d1-database/>.

The normative product contract and Units 6.1-6.2 therefore require one prepared native `D1Database.batch()` through the request binding in production, with an equivalent Prisma raw-operation-array transaction only for local SQLite/tests. Every mutation carries or causally depends on the authenticated owner and active-recipe guard; every result count, success value, affected-row count, and returned row is validated. The operation builder remains composable so Unit 6.2 can atomically include create/edit authoring and the one bound native-sync timestamp without directly mutating search tables.

## Lane Isolation

The first lane review found that the Worker-only spec was still eligible for the Happy DOM app pool. Strict TDD repaired the harness:

- Red: one failed file; one failed and four passed assertions.
- Green: one passed file; five passed assertions.
- Independent replay: `test/config/workers-vitest-lane.test.ts` passed all five assertions.

`vitest.config.ts` now excludes `test/workers/recipe-tags-d1.test.ts`, while the executable lane test proves `vitest.workers.config.ts` includes `test/workers/**/*.test.ts` and does not exclude the recipe-tag D1 spec.

## Review Record

Architecture review required three rounds. It first rejected reliance on the Prisma D1 adapter and incomplete owner/create/timestamp/search coupling, then required the dual executor, composable guarded operations, exact result validation, create foreign-key dependency, containing-Cookbook timestamp propagation, and canonical search-fingerprint authority to be normative. Round 3 converged after those requirements were added to the contract and doing units.

Test review required four rounds. Repairs covered Unicode ordering and whitespace fixtures, NFKC expansion boundaries, argument-free lowercasing, public-read versus owner-write scope, prepared operation strategy and statement inventory, strict malformed native-result matrices, local rollback, real-D1 rollback/concurrency, and finally Worker/app lane separation. Round 4 returned `CONVERGED`.

The exact-content boundary oracle passes all 9 checks with only the reviewed contract, two red specs, and lane-harness changes added to its manifest. No implementation module exists in this unit.
