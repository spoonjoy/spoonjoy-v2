# Unit 6a Red Evidence

Command:

```bash
pnpm exec vitest run test/routes/oauth-register-telemetry.test.ts
```

Result: failed as expected before OAuth register lifecycle telemetry is implemented.

Summary:

- OAuth dynamic-registration responses still execute.
- The new telemetry contract fails because `/oauth/register` does not yet emit `spoonjoy.oauth.register` for success, validation errors, method errors, or rate limits.

Failure shape:

```text
expected undefined to match object {
  event: "spoonjoy.oauth.register",
  properties: {
    route_template: "/oauth/register",
    method: "POST" | "GET",
    status: 201 | 405,
    request_bytes: Any<Number>,
    latency_ms: Any<Number>
  }
}
```
