# Unit 5f Green Evidence

Implementation commit: `1151424`

Focused MCP test:

```bash
pnpm exec vitest run test/lib/mcp/http-mcp.server.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       20 passed (20)
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

- MCP notifications now emit `spoonjoy.mcp.request` with `notification: true`.
- JSON-RPC error responses now emit safe lifecycle telemetry with `error_code: "jsonrpc_error"` and numeric `jsonrpc_error_code`.
- Existing raw exception capture remains intact for unexpected tool errors; lifecycle events do not include JSON-RPC error messages, stack traces, request bodies, or params.
