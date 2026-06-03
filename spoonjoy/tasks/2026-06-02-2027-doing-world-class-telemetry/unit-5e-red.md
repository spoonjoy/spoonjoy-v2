# Unit 5e Red Evidence

Command:

```bash
pnpm exec vitest run test/lib/mcp/http-mcp.server.test.ts
```

Result: failed as expected before MCP notification/error lifecycle telemetry is implemented.

Summary:

- Existing MCP response tests pass.
- Unit 5a/5b auth/rate-limit telemetry tests pass.
- Unit 5c/5d success telemetry tests pass.
- The new notification/error telemetry contract fails because authenticated notifications return 202 without `spoonjoy.mcp.request`.

Failure shape:

```text
expected undefined to match object {
  event: "spoonjoy.mcp.request",
  properties: {
    route_template: "/mcp",
    method: "POST",
    status: 202,
    auth_mode: "bearer",
    request_bytes: Any<Number>,
    latency_ms: Any<Number>
  }
}
```
