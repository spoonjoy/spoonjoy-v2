# Unit 5b Green Evidence

Implementation commit: `97aa4b7`

Focused MCP test:

```bash
pnpm exec vitest run test/lib/mcp/http-mcp.server.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       18 passed (18)
```

Related telemetry regressions:

```bash
pnpm exec vitest run test/routes/api.test.ts test/routes/api-v1-telemetry.test.ts test/lib/analytics-server.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       58 passed (58)
```

Additional checks:

```bash
pnpm run typecheck
pnpm run build
```

Result: both passed.

Notes:

- `/mcp` now emits `spoonjoy.mcp.request` through `waitUntil` for method-not-allowed, authentication-required, malformed authorization, invalid bearer, wrong-resource OAuth bearer, and rate-limited responses.
- Telemetry uses shared safe request-context helpers and does not read or emit JSON-RPC request bodies for these early branches.
