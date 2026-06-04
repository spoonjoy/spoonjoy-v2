# Unit 6b Green Evidence

Implementation commit: `2ae2a3e`

Focused OAuth register telemetry test:

```bash
pnpm exec vitest run test/routes/oauth-register-telemetry.test.ts
```

Result:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

Existing OAuth route/lib regression tests:

```bash
pnpm exec vitest run test/lib/oauth-routes.server.test.ts test/routes/oauth-cors.test.ts test/routes/route-shell-coverage.test.ts
```

Result:

```text
Test Files  3 passed (3)
Tests       49 passed (49)
```

Additional checks:

```bash
pnpm run typecheck
pnpm run build
```

Result: both passed.

Notes:

- `/oauth/register` now emits `spoonjoy.oauth.register` through `waitUntil` for success, validation errors, method errors, and rate limits.
- Events contain only client id, redirect URI count, scope count, status/error class, request byte count, coarse request context, rate-limit scope, and latency.
- Raw redirect URIs, client names, metadata strings, raw JSON bodies, and IP-literal hosts are not emitted.
