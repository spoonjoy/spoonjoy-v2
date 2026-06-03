# Unit 5a Red Evidence

Command:

```bash
pnpm exec vitest run test/lib/mcp/http-mcp.server.test.ts
```

Result: failed as expected before MCP lifecycle telemetry is implemented.

Summary:

- Existing MCP auth/rate-limit responses still pass.
- The new telemetry contract fails on the first early response because `spoonjoy.mcp.request` is not captured for `GET /mcp` method errors.

Failure shape:

```text
expected undefined to match object {
  event: "spoonjoy.mcp.request",
  properties: {
    route_template: "/mcp",
    method: "GET",
    status: 405,
    error_code: "method_not_allowed",
    auth_mode: "anonymous",
    request_bytes: Any<Number>,
    latency_ms: Any<Number>
  }
}
```
