# Unit 6.3c Verification

## Result

Unit 6.3c converged. My Recipes and global search now preserve one canonical recipe-filter identity from URL validation through SQL predicates and generated links. The web controls preserve a visible query draft across filtering, scope changes, and pagination; malformed filters fail as expected 400 responses, while unexpected failures rethrow unchanged.

## Focused Coverage

Command:

```sh
npx vitest run test/lib/my-recipes-search.server.test.ts test/lib/search.server.test.ts test/routes/my-recipes.test.tsx test/routes/my-recipes-query-boundary.test.ts test/routes/search.test.tsx test/routes/api-v1-search.test.ts test/routes/cookbooks-index.test.tsx test/routes/saved-recipes.test.tsx --coverage --coverage.include=app/lib/my-recipes-search.server.ts --coverage.include=app/lib/search.server.ts --coverage.include=app/routes/my-recipes.tsx --coverage.include=app/routes/search.tsx --no-file-parallelism
```

Result: 8 files and 123 tests passed with exact 100% coverage: 470/470 statements, 364/364 branches, 121/121 functions, and 425/425 lines.

The matrix covers raw iterable snapshots and bounds, validation-error identity, unexpected-error identity, single normalization, composition-sensitive Unicode identities, forged prepared filters, accessor time-of-check/time-of-use swaps, scope aliases, empty course values, canonical query ordering, draft synchronization, exact pagination reset, filter focus, native validation, the ten-tag limit, and long labels.

## Full Gate

Command:

```sh
npm run test:coverage -- --no-file-parallelism
```

The first isolated run passed 9,789 product tests and exposed four new telemetry-ratchet gaps. The four catches were classified and documented as `expected-4xx`: typed client filter validation is mapped to a public validation error or HTTP 400, while every unexpected failure rethrows unchanged. The focused telemetry gate then passed 69/69 and a cold policy reviewer returned `CONVERGED`.

The final isolated run passed all 390 files and 9,791 tests with zero warning-gate output and exact 100% coverage: 22,339/22,339 statements, 18,260/18,260 branches, 4,315/4,315 functions, and 20,507/20,507 lines.

Additional gates:

- Typecheck passed.
- Production client and SSR builds passed.
- Clem feedback exact-content boundary passed 9/9.
- `git diff --check` passed.
- Migration `0025_clem_feedback_product.sql` remained byte-identical at SHA-256 `151009d5410997365ec56c249a50c75b7aeecadd0841b677f1b0bd7a9ab2c6e6`.

## Review Convergence

Harsh static review rounds found and drove repairs for repeated normalization, Unicode identity drift, forged prepared-filter objects, accessor swapping, deceptive iterable lengths, iterator error identity, legacy shopping scope compatibility, empty courses, uncontrolled form drift, duplicate tag drafts, focus semantics, target geometry, query-draft loss across filtering/scope links, and stale pagination URLs.

The final pagination reviewer required exact location assertions, padded-draft trimming, Previous-link coverage, and a non-vacuous proof that search submission removes `page`; Round 2 returned `CONVERGED`. The final telemetry-policy reviewer independently traced all four catch sites and returned `CONVERGED`.

## Visual And Data Hygiene

The visual evidence directory contains five screenshots and machine-readable metrics for global search and My Recipes at 1440x900 and 390x844, including a 160-character query and a 40-character tag. All captures had exact viewport/document widths, no horizontal overflow, no console/page errors, contained long text, and enabled measured filter/search controls that were natively focusable and at least 44x44 px. The absurdity ledger has no open item.

The visual runner performs cleanup in an outer `finally`. Historical disposable usernames discovered during audit were repaired into the cleanup namespace and removed. A final `pnpm cleanup:qa` dry run reported zero recipes, deleted suspicious recipes, disposable users, disposable spoons, and cross-boundary blockers.
