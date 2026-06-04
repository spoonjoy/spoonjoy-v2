Unit 3f green evidence

- Implemented controlled API v1 telemetry fields for operation names, error codes, idempotency outcomes, and request byte counts.
- Error responses from `ApiV1Error` now emit lifecycle telemetry without changing response bodies or headers.
- Internal telemetry metadata is attached to `Response` objects with a private symbol so no API wire format changes are introduced.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` passed: 1 file, 11 tests.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts test/routes/api-v1-shell.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-openapi.test.ts test/routes/api-v1-scopes-public-tokens.test.ts test/routes/api-v1-shopping-sync.test.ts test/routes/api-v1-shopping-conflicts.test.ts` passed: 8 files, 55 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed.
