Unit 3i coverage/refactor evidence

- Added focused telemetry coverage for:
  - OpenAPI connector and SDK operation names
  - coarse user-agent families: node, browser, other, unknown
  - malformed Origin/Referer host omission
  - method-mismatch route template fallback for `/api/v1/shopping-list/items/{itemId}` without emitting the real item id
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` passed: 1 file, 15 tests.
- Focused coverage command:
  - `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts test/routes/api-v1-shell.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-openapi.test.ts test/routes/api-v1-scopes-public-tokens.test.ts test/routes/api-v1-shopping-sync.test.ts test/routes/api-v1-shopping-conflicts.test.ts --coverage --coverage.include=app/lib/api-v1.server.ts`
  - Tests passed: 8 files, 59 tests.
  - Coverage improved to `app/lib/api-v1.server.ts`: 92.08% statements, 85.96% branches, 99.22% functions, 93.12% lines.
  - Command exited nonzero because repo-global 100% thresholds apply to the whole pre-existing API v1 route module; remaining uncovered lines include older non-telemetry route validation and idempotency edge branches.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts test/routes/api-v1-shell.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-openapi.test.ts test/routes/api-v1-scopes-public-tokens.test.ts test/routes/api-v1-shopping-sync.test.ts test/routes/api-v1-shopping-conflicts.test.ts` passed: 8 files, 59 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed.
