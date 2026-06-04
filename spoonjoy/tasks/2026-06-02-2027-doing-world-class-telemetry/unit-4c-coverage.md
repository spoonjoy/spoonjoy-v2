# Unit 4c Coverage Evidence

Coverage/refactor commit: `28f7021`

Focused coverage command:

```bash
pnpm exec vitest run test/routes/api.test.ts test/routes/route-shell-coverage.test.ts test/lib/analytics-server.test.ts --coverage --coverage.include='app/routes/api.$.ts' --coverage.include=app/lib/analytics-server.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       53 passed (53)

All files          100% statements / 100% branches / 100% functions / 100% lines
app/lib/analytics-server.ts 100% statements / 100% branches / 100% functions / 100% lines
app/routes/api.$.ts         100% statements / 100% branches / 100% functions / 100% lines
```

Additional checks:

```bash
pnpm run typecheck
pnpm run build
```

Result: both passed.
