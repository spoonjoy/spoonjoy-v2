# Unit 8a: Docs/Config/Sink Setup Tests

## Intent

Add red tests that fail until the telemetry setup story is documented and guarded by deployment preflight checks.

## Changes

- `test/scripts/deployment-preflight.test.ts` now expects `validateDeploymentConfig` to flag missing PostHog runtime env typings, docs, and deployment commands.
- The same test file now validates the real repository docs/config:
  - `docs/analytics-privacy.md`
  - `README.md`
  - `DEPLOY.md`
  - `.env.example`
  - `app/cloudflare-env.d.ts`

## Red Test Command

```bash
pnpm exec vitest run test/scripts/deployment-preflight.test.ts
```

## Red Result

The focused suite failed as intended:

- `flags missing telemetry typing, documentation, and deployment commands`
  - `validateDeploymentConfig` currently returns no telemetry-specific errors.
- `documents the full PostHog client and server telemetry setup`
  - `docs/analytics-privacy.md` does not yet document the new lifecycle event names, starting with `spoonjoy.api_v1.request`.

Summary: 1 failed file, 2 failed tests, 52 passed tests.

## Privacy Contract Covered

The tests require docs/config to name the safe event surface while continuing to exclude:

- request bodies
- response bodies
- cookies
- headers
- query strings
- real-looking PostHog key values in `.env.example`
