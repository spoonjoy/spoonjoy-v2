# Unit 8b: Docs/Config/Sink Setup Implementation

## Intent

Make the Unit 8a red tests pass by documenting the full PostHog client/server telemetry setup and adding deployment-preflight guardrails for the optional telemetry env surface.

## Changed Files

- `scripts/deployment-preflight.ts`
- `docs/analytics-privacy.md`
- `docs/deployment.md`
- `DEPLOY.md`
- `README.md`
- `.env.example`

## Verification

```bash
pnpm exec vitest run test/scripts/deployment-preflight.test.ts
```

Result: PASS, 1 file, 54 tests.

```bash
pnpm run typecheck
```

Result: PASS.

```bash
pnpm run build
```

Result: PASS. Build output still includes the existing baseline notices:

- `Using Vite Environment API (experimental)`
- `Generated an empty chunk: "oauth.revoke".`
- `Using secrets defined in .env`
- `Using secrets defined in .env.local`

## Secret Safety

- `.env.example` keeps `VITE_POSTHOG_KEY` and `POSTHOG_KEY` blank.
- Docs explain that `VITE_POSTHOG_KEY` is public build-time configuration and `POSTHOG_KEY` is set with `wrangler secret put POSTHOG_KEY`.
- Docs explain `POSTHOG_DISABLED` and `VITE_POSTHOG_DISABLED` kill switches.
- No secret values were committed or written to artifacts.
