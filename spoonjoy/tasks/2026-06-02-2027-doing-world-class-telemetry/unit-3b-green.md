Unit 3b green evidence

- Implemented best-effort `spoonjoy.api_v1.request` capture for public/discovery API v1 success paths through `ctx.waitUntil(captureEvent(...))`.
- `pnpm exec vitest run test/routes/api-v1-telemetry.test.ts` passed: 1 file, 3 tests.
- `pnpm exec vitest run test/routes/api-v1-shell.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-openapi.test.ts` passed sequentially: 4 files, 30 tests.
- `pnpm run typecheck` passed.
- `pnpm run build` passed.

Note: a first attempt launched DB-backed Vitest files in separate parallel processes and hit shared test database cleanup races. The same focused coverage passed when run in a single Vitest process.
