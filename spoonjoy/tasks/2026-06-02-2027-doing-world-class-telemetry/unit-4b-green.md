# Unit 4b Green Evidence

Implementation commit: `3c3c37e`

Focused tests:

```bash
pnpm exec vitest run test/routes/api.test.ts test/routes/route-shell-coverage.test.ts test/lib/analytics-server.test.ts test/routes/api-v1-telemetry.test.ts
```

Result:

```text
Test Files  4 passed (4)
Tests       68 passed (68)
```

Typecheck:

```bash
pnpm run typecheck
```

Result: passed.

Build:

```bash
pnpm run build
```

Result: passed. Existing build output included Vite's experimental Environment API notice and the pre-existing empty `oauth.revoke` chunk line.

Notes:

- Legacy REST route now emits `spoonjoy.legacy_api.request` through `waitUntil` when PostHog is configured.
- Existing unexpected-error exception capture is preserved.
- API v1 and legacy REST share request byte, safe host, and coarse user-agent helper logic from `app/lib/analytics-server.ts`.
