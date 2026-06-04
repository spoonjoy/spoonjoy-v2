Unit 3d green evidence

- Implemented authenticated `spoonjoy.api_v1.request` metadata for session, personal bearer, OAuth bearer, optional authenticated public reads, private reads, and base success telemetry around API v1 mutations.
- OAuth-only properties now emit only when an OAuth client id is present; personal bearer/session events do not carry null OAuth fields.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` passed: 1 file, 7 tests.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts test/routes/api-v1-shell.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-openapi.test.ts test/routes/api-v1-scopes-public-tokens.test.ts test/routes/api-v1-shopping-sync.test.ts test/routes/api-v1-shopping-conflicts.test.ts` passed: 8 files, 51 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed.
