# Unit 5.1 SavedRecipe Service Verification

## Scope

Unit 5.1 adds the private SavedRecipe query/mutation service and its strict
cursor codec. The service is independent from cookbook membership, scopes every
read and mutation to the owner key, excludes soft-deleted recipes from reads,
and never materializes more than `limit + 1` rows.

## TDD And Review

- Unit 5.1a froze 46 red service contracts in commit `1a563a83`; the red run
  failed only on the absent service module.
- Unit 5.1b landed the initial implementation in commit `1cac98f0`. Its 46/46
  focused tests, typecheck, production build, and cold privacy/concurrency
  review passed.
- Unit 5.1c first reached exact focused coverage, then a fresh data/privacy
  reviewer found a deletion time-of-check/time-of-use race and an incomplete
  cascade assertion.
- A new race test failed against the read-then-upsert implementation because a
  save succeeded after soft deletion. The repair uses one parameterized SQLite
  `INSERT ... SELECT` from the active Recipe row with conflict-preserving
  `RETURNING`, making active-recipe enforcement and insert-or-observe one
  statement. Soft- and hard-delete race tests, immediate cascade proof, and an
  exact outgoing SQL/bind-order assertion pass. Round-two review converged.

## Final Evidence

- Focused SavedRecipe service: 50/50 tests passed.
- Focused Istanbul: 100% statements (119/119), branches (90/90), functions
  (20/20), and lines (114/114).
- Rejected-scope plus telemetry ratchets: 78/78 tests passed.
- Full app gate: 388/388 files and 9,345/9,345 tests passed.
- Full Istanbul: 100% statements (21,109/21,109), branches (17,066/17,066),
  functions (4,080/4,080), and lines (19,406/19,406).
- Warning-policy typecheck and production build passed.
- `git diff --check` passed.
- Cursor parse catches are explicitly classified as expected client validation
  failures in the telemetry ratchet; no operational error is swallowed.

## Result

Unit 5.1's cursor, query, pagination, owner-isolation, concurrent save,
deletion, cookbook-independence, and malformed-storage branches are covered and
the fresh data/privacy review converged with no remaining BLOCKER or MAJOR
finding.
