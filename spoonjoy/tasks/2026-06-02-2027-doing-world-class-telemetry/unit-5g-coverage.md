# Unit 5g Coverage Evidence

Coverage/refactor commit: `ec051a4`

Focused coverage command:

```bash
pnpm exec vitest run test/lib/mcp/http-mcp.server.test.ts test/lib/analytics-server.test.ts --coverage --coverage.include=app/lib/mcp/http-mcp.server.ts --coverage.include=app/lib/analytics-server.ts
```

Result:

```text
Test Files  2 passed (2)
Tests       54 passed (54)

All files                         100% statements / 100% branches / 100% functions / 100% lines
app/lib/analytics-server.ts       100% statements / 100% branches / 100% functions / 100% lines
app/lib/mcp/http-mcp.server.ts    100% statements / 100% branches / 100% functions / 100% lines
```

Additional checks:

```bash
pnpm exec vitest run test/routes/api.test.ts test/routes/api-v1-telemetry.test.ts test/lib/analytics-server.test.ts
pnpm run typecheck
pnpm run build
```

Result: all passed.
