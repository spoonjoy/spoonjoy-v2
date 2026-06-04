# Unit 6e Red Check

Command:

```bash
pnpm exec vitest run test/routes/oauth-token-telemetry.test.ts
```

Result: failed as expected before implementation.

Summary:
- `spoonjoy.oauth.token` was not emitted for a successful `authorization_code` exchange.
- `spoonjoy.oauth.token` was not emitted for method errors.
- The contract also covers refresh-token rotation success, unsupported grants, invalid grants, invalid content-type form bodies, oversized form bodies, raw-IP exclusion, and rate limits once the first missing event is implemented.

Privacy and scheduling assertions in the red contract:
- No authorization code, PKCE challenge/verifier, redirect URI query, access token value, refresh token value, token prefixes, raw form body, raw IP on any path, or arbitrary grant text may appear in lifecycle telemetry; the controlled grant class `refresh_token` is allowed.
- Each event must be scheduled through the Cloudflare Worker `ctx.waitUntil` hook with the exact `captureEvent` promise.
