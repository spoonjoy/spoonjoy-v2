# Unit 3.1a Red Evidence

## Scope

`test/lib/shopping-list-mutations.server.test.ts` now freezes the final atomic shopping add/restore boundary through two new public service APIs:

- `prepareAtomicShoppingListItemD1Write(database, mutation)` prepares the one SQLite statement and its exact bindings.
- `runAtomicShoppingListBatch({ database, nativeDatabase, mutations })` executes identical statements through one local Prisma array transaction or one native D1 batch and returns authoritative normalized results and counts.

The seed-only compatibility provisioner remains outside this service and retains its own test suite.

## Frozen Behavior

- One `WITH ... INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement targets the exact partial expression index and forces a materialized preexisting-identity marker.
- Incoming quantity binds a separate validity marker so JavaScript `NaN` cannot become an intentional SQL null.
- Quantity, category, icon, logical checked state, active/deleted identity, fresh-end position, signed-Int overflow, unit discriminator, and canonical result semantics cover every boundary in the product contract.
- Account-global high-water covers User, active Recipe, Cookbook, NativeSyncTombstone, ShoppingList, active item, and deleted item clocks; malformed, missing, non-finite, out-of-range, rollback, offset, text, integer, real, and maximum-canonical cases are executable.
- A two-worker, two-connection WAL test races the same active identity and requires one stored row, the complete quantity sum, the same winning ID, and exactly one created marker.
- Local and native D1 adapters require one returned row per statement, preserve order, derive counts from SQL markers, normalize booleans and dates, reject malformed/unsuccessful/cardinality-skewed results, and never retry or return speculative planned rows.
- Deterministic recipe coalescing retains SQLite UTF-8 BINARY order, finite scaling, first non-null metadata, and overflow rejection.

## Red Run

Command:

```bash
pnpm exec vitest run test/lib/shopping-list-mutations.server.test.ts --reporter=dot
```

Result: 92 tests total, 31 passing and 61 intentionally failing. The failures are rooted at the deliberate `Atomic shopping statement is not implemented` and `Atomic shopping batch is not implemented` guards because neither final export exists in the transitional runtime. No failure requires preserving the old lookup/update/retry service.

## Clean Gates

```bash
pnpm run verify:clean:typecheck
git diff --check
```

Both pass with zero warnings.

## Review Repairs

Harsh review removed obsolete create/update and lookup/retry assertions, replaced candidate-ID created inference with a materialized pre-state contract and same-ID discriminator, matched production SQLite affinities, added actual independent-connection concurrency, froze sort overflow behavior, made each time encoding independently decisive, added D1/local result cardinality and normalization, and introduced the explicit NaN validity marker.

Reviewer `019f8c1d-19fc-7f30-8344-fc70c0a5d35d` converged after four rounds, including final valid and invalid foreign-owner Cookbook isolation.
