Unit 3h green evidence

- Implemented lifecycle telemetry for API v1 rate-limit responses and internal-error responses.
- Preserved known principal metadata for insufficient-scope errors after authorization resolves a principal.
- Hardened route templates so method-mismatch errors use controlled resource templates and unknown paths use `/api/v1/{unknown}` instead of raw path text.
- Made telemetry observation fail closed when request-scoped Cloudflare context access itself throws during internal-error cleanup.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` passed: 1 file, 14 tests.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts test/routes/api-v1-shell.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-openapi.test.ts test/routes/api-v1-scopes-public-tokens.test.ts test/routes/api-v1-shopping-sync.test.ts test/routes/api-v1-shopping-conflicts.test.ts` passed: 8 files, 58 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed.
