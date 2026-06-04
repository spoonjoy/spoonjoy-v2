# Unit 5c Red Evidence

Command:

```bash
pnpm exec vitest run test/lib/mcp/http-mcp.server.test.ts
```

Result: failed as expected before MCP success lifecycle telemetry is implemented.

Summary:

- Existing MCP response tests pass.
- Unit 5a/5b auth and rate-limit telemetry tests pass.
- The new success metadata contract fails because authenticated `tools/list` and `tools/call` responses do not yet emit `spoonjoy.mcp.request`.

Failure shape:

```text
expected undefined to match object {
  event: "spoonjoy.mcp.request",
  properties: {
    route_template: "/mcp",
    method: "POST",
    status: 200,
    auth_mode: "bearer",
    request_bytes: Any<Number>,
    latency_ms: Any<Number>
  }
}
```
