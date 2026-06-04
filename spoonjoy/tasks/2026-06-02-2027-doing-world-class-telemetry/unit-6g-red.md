# Unit 6g Red Check

Command:

```bash
pnpm exec vitest run test/routes/oauth-revoke-telemetry.test.ts
```

Result: failed as expected before implementation.

Summary:
- `spoonjoy.oauth.revoke` was not emitted for refresh-token revoke success.
- `spoonjoy.oauth.revoke` was not emitted for method errors.
- The contract also covers not-found revokes, client-binding errors, invalid content-type form bodies, and rate limits once the first missing event is implemented.

Privacy and scheduling assertions in the red contract:
- No refresh token value, token prefix, raw form body, raw IP, raw client id from unsafe branches, cookie value, or auth header value may appear in lifecycle telemetry.
- The controlled token hint class `refresh_token` is allowed; unsupported hint text is collapsed to `unsupported`.
- Each event must be scheduled through the Cloudflare Worker `ctx.waitUntil` hook with the exact `captureEvent` promise.
