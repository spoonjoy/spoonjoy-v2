# Setup Notes

## Environment State

- Checked production Worker secrets with `pnpm exec wrangler secret list` on 2026-06-03.
- `POSTHOG_KEY`: not present in Cloudflare secrets.
- `POSTHOG_HOST`: not present as a Cloudflare secret or var.
- `POSTHOG_DISABLED`: not present as a Cloudflare secret or var.
- Local env files checked for variable names only: `.env`, `.env.local`, `.dev.vars`, `.env.example`.
- Actual local PostHog values were not printed.
- `.env.example` declares `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST`.
- No actual local `VITE_POSTHOG_KEY` value was found by name in `.env`, `.env.local`, or `.dev.vars`.
- `wrangler.json` production vars currently include `NODE_ENV` and `SPOONJOY_BASE_URL`, not PostHog vars.

## Unit 8d PostHog Setup Check

- Rechecked Cloudflare Worker secrets with `pnpm exec wrangler secret list --format=json` on 2026-06-03 at 10:20.
- `POSTHOG_KEY`: missing.
- Required runtime secrets checked at the same time:
  - `SESSION_SECRET`: present.
  - `VAPID_PUBLIC_KEY`: present.
  - `VAPID_PRIVATE_KEY`: present.
  - `VAPID_SUBJECT`: present.
- Rechecked local deploy/build env files for variable names only; no values were printed.
  - `.env.local`: `VITE_POSTHOG_KEY` missing, `POSTHOG_KEY` missing.
  - `.env`: `VITE_POSTHOG_KEY` missing, `POSTHOG_KEY` missing.
  - `.dev.vars`: absent.
- `wrangler.json` still does not commit `POSTHOG_KEY` or `VITE_POSTHOG_KEY`, which is the correct secret posture.
- External setup still required to enable telemetry capture:
  - Obtain the PostHog project API key from PostHog project settings.
  - Set the Worker runtime ingestion key with `wrangler secret put POSTHOG_KEY`.
  - Provide the same public project key to the environment that runs `pnpm run build` as `VITE_POSTHOG_KEY`.
  - Keep `POSTHOG_DISABLED` and `VITE_POSTHOG_DISABLED` unset or false-ish unless intentionally disabling telemetry.
- Until those values are supplied, the deployed app remains telemetry-disabled by design while the API/docs/playground code paths continue to function.

## PostHog Enablement Follow-Up

- Rechecked and enabled PostHog on 2026-06-03 at 20:22 after the user signed in to PostHog in the in-app browser.
- Extracted the existing PostHog project API key from the authenticated project settings page without printing the value.
- Set Cloudflare Worker runtime telemetry with `wrangler secret put POSTHOG_KEY`.
- Verified Cloudflare secret names only:
  - `POSTHOG_KEY`: present.
  - `SESSION_SECRET`: present.
  - `VAPID_PUBLIC_KEY`: present.
  - `VAPID_PRIVATE_KEY`: present.
  - `VAPID_SUBJECT`: present.
- Updated ignored `.env.local` for deploy builds:
  - `VITE_POSTHOG_KEY`: present.
  - `VITE_POSTHOG_HOST`: present.
  - `VITE_POSTHOG_DISABLED`: blank.
  - `POSTHOG_KEY`: not written locally.
- Verified the live deployed client assets contain the public PostHog key pattern, PostHog host, and PostHog code without printing the key.
- Redeployed production Worker version `ba5c472c-cd9d-4ed6-8038-ad7eeace6b10`.
- `pnpm run smoke:api` passed.
- `pnpm run smoke:live -- --base-url https://spoonjoy.app --remote-cleanup` passed with zero console errors, zero page errors, and no cleanup error.
- No PostHog key value was printed, committed, or written to tracked artifacts.

## Existing Telemetry State

- Client analytics is already gated by `VITE_POSTHOG_KEY` in `app/entry.client.tsx` through `resolvePostHogConfig` in `app/lib/analytics.ts`.
- Client pageviews are captured in `app/root.tsx` with origin + pathname only.
- Recipe-detail client events exist in `app/routes/recipes.$id.tsx`.
- Server-side PostHog capture currently only covers exceptions through `captureException` in `app/lib/analytics-server.ts`.
- Existing server exception wiring appears in `app/entry.server.tsx`, `workers/app.ts`, `app/routes/api.$.ts`, and `app/lib/mcp/http-mcp.server.ts`.

## Route Chokepoints

- API v1 route shell: `app/routes/api.v1.$.ts`
- API v1 centralized handler: `app/lib/api-v1.server.ts`
- Legacy API route shell/dispatcher: `app/routes/api.$.ts`
- MCP HTTP transport: `app/lib/mcp/http-mcp.server.ts`
- OAuth register shell: `app/routes/oauth.register.ts`
- OAuth authorize shell: `app/routes/oauth.authorize.tsx`
- OAuth token shell: `app/routes/oauth.token.ts`
- OAuth revoke shell: `app/routes/oauth.revoke.ts`
- OAuth shared handlers: `app/lib/oauth-routes.server.ts`
- Developer docs surface: `app/routes/developers.tsx`
- Developer playground surface: `app/routes/developers.playground.tsx`
- Generated playground manifest: `app/lib/generated/api-v1-playground.ts`

## Implementation Files

- Server event helper: `app/lib/analytics-server.ts`
- Client event helper/bootstrap: `app/lib/analytics.ts`, `app/entry.client.tsx`, `app/vite-env.d.ts`
- API v1 telemetry: `app/lib/api-v1.server.ts`, with `app/routes/api.v1.$.ts` only if type plumbing requires it
- Legacy API telemetry: `app/routes/api.$.ts`
- MCP telemetry: `app/lib/mcp/http-mcp.server.ts`
- OAuth telemetry: `app/routes/oauth.register.ts`, `app/routes/oauth.authorize.tsx`, `app/routes/oauth.token.ts`, `app/routes/oauth.revoke.ts`, `app/lib/oauth-routes.server.ts`
- Developer docs/playground telemetry: `app/lib/analytics.ts`, `app/routes/developers.tsx`, `app/routes/developers.playground.tsx`
- Docs/config: `docs/analytics-privacy.md`, `.env.example`, `README.md`, `DEPLOY.md`, `app/cloudflare-env.d.ts`, `wrangler.json` only if a non-secret PostHog var is needed

## Test Targets

- Server analytics helper: `test/lib/analytics-server.test.ts`
- Client analytics helper: `test/lib/analytics.test.ts`
- API v1 telemetry: existing `test/routes/api-v1-*.test.ts` and/or focused `test/lib/api-v1*.test.ts`
- Legacy API route shell: `test/routes/route-shell-coverage.test.ts` or a focused legacy API route test
- MCP telemetry: `test/lib/mcp/http-mcp.server.test.ts`
- OAuth telemetry: existing focused OAuth route tests
- Developer docs/playground telemetry: `test/routes/developers.test.tsx`, `test/routes/developers-playground.test.tsx`, and helper coverage in `test/lib/analytics.test.ts`
- Deployment/docs preflight: `test/scripts/deployment-preflight.test.ts`, `test/scripts/production-readiness.test.ts` if existing coverage applies
