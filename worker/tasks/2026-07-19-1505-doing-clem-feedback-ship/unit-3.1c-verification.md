# Unit 3.1c Verification

## Verified implementation

- Implementation commit: `f22f3bcd` (`feat: linearize shopping list additions atomically`).
- `prepareAtomicShoppingListItemD1Write` emits one bound SQLite `INSERT ... ON CONFLICT ("shoppingListId", "ingredientRefId", COALESCE('u:' || "unitId", 'n:')) WHERE "deletedAt" IS NULL DO UPDATE ... RETURNING` statement with no schema detection or mutation retry.
- Local SQLite executes a Prisma raw-statement array transaction; D1 executes one database batch. Both adapters require one successful result row per mutation and decode the same canonical output.
- Quantity aggregation, nullable incoming metadata replacement, logical checked preservation, fresh IDs after tombstones, deterministic fresh-end ordering, canonical UTC timestamps, and the owner account-global native-sync high-water are computed inside the database statement.
- The account high-water query uses one materialized CTE per resource family instead of a compound `UNION ALL`, because real Workerd D1 rejects the six-arm compound form as `too many terms in compound SELECT`.
- Web manual/recipe, REST manual/recipe, and shared-agent/MCP manual/recipe additions all use the atomic service. Existing check, delete, clear, and sync serializers retain their prior contracts.
- Transitional runtime selectors, retry helpers, D1 planners, and batch rebuild APIs were removed. The seed provisioner owns its active-first/tombstone fallback and one bounded exact-identity conflict reread privately.
- The telemetry allowlist follows the seed-only catch boundary; the atomic mutation service has no catch-bearing compatibility path.

## Automated gates

- `pnpm run test:coverage`: 383 files and 9,168 tests passed with zero warning output.
- Coverage: 20,904/20,904 statements, 16,941/16,941 branches, 4,033/4,033 functions, and 19,217/19,217 lines (100% each).
- `pnpm run verify:clean:test:workers:coverage`: two files and 44 real-Workers tests passed at exact 100% statement, branch, function, and line coverage.
- Real Workerd D1 tests pass all 14 shopping cutover cases, including six-writer fresh-ID behavior and an actual Prisma D1 expression-index `P2002` seed race.
- `pnpm run verify:clean:typecheck`: passed.
- `pnpm run verify:clean:typecheck:scripts`: passed.
- `pnpm run verify:clean:build`: passed; client and Worker SSR bundles completed without warning output.
- Repeated API playground generation leaves no diff.
- `git diff --check`: passed.
- Repository search finds no remaining `runCompatibleShoppingListBatch`, `findCompatibleShoppingListItem`, `createCompatibleShoppingListD1Batch`, `mutateCompatibleShoppingListItem`, `ShoppingListItemWritePlan`, or `isShoppingListUniqueConflict` references.

## Contract coverage

- Exact SQL and bindings cover null/finite/non-finite quantity, overflow rollback, null/empty/arbitrary units, category/icon replacement, checked and tombstoned identities, created counts, result cardinality, and malformed D1 envelopes.
- Clock tests cover mixed integer/real/ISO/offset/SQLite-current timestamp encodings, each account-owned resource family, strict `+1ms` advancement, lower-sorting fresh IDs, canonical output, and invalid or overflowing timestamps.
- Independent-connection concurrency tests cover insert/insert, update/update, delete/add, bulk coalescing, and all-or-nothing rollback.
- Web, REST, shared-agent/MCP, native-sync, and seed tests cover fresh IDs, incoming metadata, zero quantity, monotonic readback, untouched tombstones, no runtime retry, and non-add null-max interleavings.

## Adversarial review

Fresh SQL/concurrency review converged after closing:

- real D1 incompatibility with the original compound high-water query;
- permissive D1 success decoding and malformed row coercion;
- dead transitional D1 planners and retry exports;
- seed-only compatibility helpers leaking from runtime mutation ownership;
- weakened metadata assertions that no longer proved replacement; and
- non-add `findFirstOrThrow` regressions during concurrent clear/delete interleavings.

The final reviewer rechecked the Unit 3.1 boundary, private seed compatibility behavior, actual Prisma-D1 race path, all six runtime integrations, transaction boundaries, strict decoding, and non-add interleavings, and returned `CONVERGED` with no findings.
