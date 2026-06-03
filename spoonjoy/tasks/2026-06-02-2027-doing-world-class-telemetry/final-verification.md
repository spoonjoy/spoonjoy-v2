# Final Verification

## Commands

```bash
pnpm run typecheck
```

Result: PASS.

```bash
pnpm exec vitest run test/lib/analytics-server.test.ts test/lib/analytics.test.ts test/entry-client-analytics.test.tsx test/routes/api-v1-shell.test.ts test/routes/api-v1-telemetry.test.ts test/routes/api-v1-recipes.test.ts test/routes/api-v1-cookbooks.test.ts test/routes/api-v1-shopping-mutations.test.ts test/routes/api-v1-shopping-conflicts.test.ts test/routes/api-v1-tokens.test.ts test/routes/api-v1-scopes.test.ts test/routes/api-v1-scopes-public-tokens.test.ts test/routes/api-v1-openapi.test.ts test/routes/api.test.ts test/routes/route-shell-coverage.test.ts test/lib/mcp/http-mcp.server.test.ts test/routes/oauth-register-telemetry.test.ts test/routes/oauth-authorize-telemetry.test.tsx test/routes/oauth-token-telemetry.test.ts test/routes/oauth-revoke-telemetry.test.ts test/lib/oauth-routes-defensive-coverage.test.ts test/routes/oauth-authorize.test.tsx test/routes/developers.test.tsx test/routes/developers-playground.test.tsx test/scripts/deployment-preflight.test.ts
```

Result: PASS, 25 files, 264 tests.

```bash
pnpm exec vitest run
```

Result: PASS, 286 files, 5,452 tests.

```bash
pnpm run build
```

Result: PASS.

Build emitted existing baseline notices:

- `Using Vite Environment API (experimental)`
- `Generated an empty chunk: "oauth.revoke".`
- `Using secrets defined in .env`
- `Using secrets defined in .env.local`

## Secret Scan

```bash
rg -n -e 'phc_' -e 'phx_' -e 'sk-[A-Za-z0-9]' -e 'sj_[A-Za-z0-9]' -e 'POSTHOG_KEY="[^"]+"' -e 'VITE_POSTHOG_KEY="[^"]+"' .env.example README.md DEPLOY.md docs/deployment.md docs/analytics-privacy.md test/scripts/deployment-preflight.test.ts spoonjoy/tasks/2026-06-02-2027-doing-world-class-telemetry || true
```

Result: only intentional regex references were found:

- `test/scripts/deployment-preflight.test.ts` rejects real-looking PostHog key examples.
- `unit-8c-docs-config-verification.md` records the same secret-scan command.

No real secret values were printed, committed, or written to artifacts.

## Unit 8d Status

Unit 8d completed via the accepted unavailable-key path:

- `POSTHOG_KEY` is missing from Cloudflare Worker secrets.
- `VITE_POSTHOG_KEY` is missing from `.env`, `.env.local`, and `.dev.vars`.
- The remaining external setup step is recorded in `setup-notes.md` and `unit-8d-posthog-secret-build-env.md`.
- Production telemetry remains disabled by default until the PostHog project key is supplied to Wrangler and the build environment.

## Deployment And Live Smoke

```bash
pnpm run deploy
```

Result: PASS.

- Remote D1 preflight: PASS, no pending migrations.
- Worker URL: `https://spoonjoy-v2.mendelow-studio.workers.dev`
- Production app URL: `https://spoonjoy.app`
- Current Version ID: `1b0cc956-4d31-4446-a03c-57739fc7a230`
- PostHog bindings: absent from deploy output, matching Unit 8d's recorded unavailable-key/default-disabled state.

```bash
pnpm run smoke:live
```

Result: PASS.

- Artifact path: `live-smoke-artifacts/smoke-results.json`
- Smoke screenshots:
  - `live-smoke-artifacts/01-recipes-after-signup.png`
  - `live-smoke-artifacts/02-recipe-detail.png`
  - `live-smoke-artifacts/03-cook-mode.png`
  - `live-smoke-artifacts/04-shopping-list.png`
  - `live-smoke-artifacts/05-account-settings.png`
- Remote cleanup: deleted smoke user `codex-smoke-mpycgf3r@example.com`; Wrangler reported 8 rows changed.

```bash
pnpm run smoke:api
```

Result: PASS.

- Artifact path: `api-live-smoke-artifacts/api-smoke-results.json`
- Checks passed:
  - API docs route
  - Playground alias route
  - request id echo and stable error envelope
  - OpenAPI path parity and dynamic server
  - SDK profile includes token lifecycle
  - OAuth token CORS preflight
  - DELETE mutation header CORS preflight
  - public cache headers

Additional live probes:

- `https://spoonjoy.app/api`: 200 HTML
- `https://spoonjoy.app/api/playground`: 200 HTML
- `https://spoonjoy.app/api/v1/health`: 200 JSON with `ok: true`
- `https://spoonjoy.app/mcp`: 405 JSON for GET, expected method guard
- `https://spoonjoy.app/.well-known/oauth-authorization-server`: 200 JSON
- `https://spoonjoy.app/.well-known/oauth-protected-resource`: 200 JSON

```bash
pnpm exec vitest run test/repo-hygiene.test.ts test/build-output-hygiene.test.ts
```

Result: PASS, 2 files, 8 tests. `live-smoke-artifacts/` and `api-live-smoke-artifacts/` are ignored generated smoke outputs.
