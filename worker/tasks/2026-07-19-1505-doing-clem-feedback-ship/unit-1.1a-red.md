# Unit 1.1a Red Evidence

Command:

```text
pnpm exec vitest run test/config/workers-vitest-lane.test.ts test/config/warning-policy.test.ts
```

Result: expected failure, 2 files failed and all 16 new contract tests failed.

The failures are confined to the intentionally absent Unit 1.1 infrastructure:

- Vitest packages are still `4.0.18` and the Workers pool is absent.
- `vitest.workers.config.ts`, `vitest.workers.setup.ts`, and `wrangler.workers-test.json` do not exist.
- Workers tests are not excluded from the app lane and CI has no Workers coverage job.
- `scripts/run-with-warning-policy.mjs` and clean verification package scripts do not exist.
- The app setup still contains the legacy React/SQLite warning suppression.
- `e2e/fixtures.ts` does not exist and 17 Playwright spec/setup files still import runtime `test`/`expect` directly from `@playwright/test`.

No pre-existing product assertion failed.
