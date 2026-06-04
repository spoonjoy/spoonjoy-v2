# Unit 1c Coverage

Commands:

```bash
pnpm exec vitest run test/lib/analytics-server.test.ts
pnpm exec vitest run --coverage test/lib/analytics-server.test.ts
pnpm run build
pnpm run build
```

Results:

- Focused analytics-server test after branch additions: 30 passed.
- Coverage report shows `app/lib/analytics-server.ts` at 100% statements, 100% branches, 100% functions, and 100% lines.
- The focused coverage command exits 1 because `vitest.config.ts` applies global 100% thresholds to the full configured app coverage include list even during a single-test-file run; unrelated app files are reported as uncovered.
- First build after coverage additions exited 0 but printed a transient `The build was canceled` line while continuing to completion.
- Immediate build rerun exited 0 and did not repeat the transient canceled line.
