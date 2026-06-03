# Unit 6c Red Check

Command:

```bash
pnpm exec vitest run test/routes/oauth-authorize-telemetry.test.tsx
```

Result: failed as expected before implementation.

Summary:
- `spoonjoy.oauth.authorize` was not emitted for the loader login-gate redirect.
- `spoonjoy.oauth.authorize` was not emitted for the action approve path.
- The contract also covers loader consent, client error, loader/action rate-limit, action deny, and action validation-error paths once the first missing event is implemented.

Privacy and scheduling assertions in the red contract:
- No authorization code, OAuth `state`, PKCE challenge/verifier, redirect URI query, raw form body, raw IP, invalid scope text, or unknown raw client id may appear in lifecycle telemetry.
- Each event must be scheduled through the Cloudflare Worker `ctx.waitUntil` hook with the exact `captureEvent` promise.
