# Cloudflare Deployment Checklist

Spoonjoy v2 deploys to Cloudflare Workers with D1 for data and R2 for uploaded profile/recipe photos. This checklist is intentionally explicit so agents can verify deploy readiness without relying on tribal memory.

## Required Bindings

`wrangler.json` must define these bindings:

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 database | Prisma-backed application data |
| `PHOTOS` | R2 bucket | Profile and recipe image uploads served through `/photos/*` |

Create first-time production resources with the commands below. R2 must first be enabled in Cloudflare Dashboard > R2 Object Storage; if it is not enabled, Wrangler returns `10042: Please enable R2 through the Cloudflare Dashboard`.

```bash
wrangler d1 create spoonjoy
wrangler r2 bucket create spoonjoy-photos
wrangler r2 bucket list
```

After creating D1, copy the returned `database_id` into `wrangler.json` under the `DB` binding. Verify both D1 and R2 resources live in the same Cloudflare account used by `CLOUDFLARE_ACCOUNT_ID`/Wrangler deploy credentials.

## Required Secrets

Set production secrets with `wrangler secret put`:

```bash
wrangler secret put SESSION_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put APPLE_CLIENT_ID
wrangler secret put APPLE_TEAM_ID
wrangler secret put APPLE_KEY_ID
wrangler secret put APPLE_PRIVATE_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_API_KEY
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT
```

Notes:

- `SESSION_SECRET` protects auth sessions and must be high entropy in production.
- Google, GitHub, and Apple OAuth secrets are required for the corresponding OAuth login/account-linking provider.
- `OPENAI_API_KEY` enables ingredient parsing and the OpenAI recipe-image provider. Missing local keys fall back to deterministic parsing paths where supported, but production should set the secret before enabling AI-assisted flows.
- `GOOGLE_API_KEY` or `GEMINI_API_KEY` enables Gemini recipe-image fallback. Prefer `GOOGLE_API_KEY` for production unless a provider-specific alias is needed.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` are required for `/api/push/public-key` and web-push subscription flows.
- `POSTHOG_KEY` is optional. When set, it enables server lifecycle telemetry for API v1, legacy API, MCP, OAuth, and Worker error capture. Leave it unset, or set `POSTHOG_DISABLED=true`, to keep server telemetry off.
- Client analytics is built into the Vite bundle only when `VITE_POSTHOG_KEY` is present during `pnpm run build`. Use `VITE_POSTHOG_HOST` for the ingestion host and `VITE_POSTHOG_DISABLED=true` for an explicit client kill switch. These `VITE_` values are public build-time configuration, not secrets.
- Optional ingredient parsing runtime knobs are `INGREDIENT_PARSE_PROVIDER`, `INGREDIENT_PARSE_MODEL`, `INGREDIENT_PARSE_TIMEOUT_MS`, and `INGREDIENT_PARSE_MAX_RETRIES`. The safe default is OpenAI with `gpt-4o-mini`, an 8000ms timeout, and 1 retry.
- Optional recipe-image provider runtime knobs are `IMAGE_PROVIDER_PRIMARY`, `IMAGE_PROVIDER_FALLBACKS`, `GEMINI_IMAGE_MODEL`, and `GEMINI_IMAGE_TIMEOUT_MS`. The safe default is configured providers in `openai,gemini` order with a 30000ms Gemini request timeout; set `IMAGE_PROVIDER_PRIMARY=gemini`, `IMAGE_PROVIDER_FALLBACKS=openai`, and `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image` to route image stylization through Gemini first.

### Optional PostHog Telemetry

To enable server lifecycle telemetry and error capture:

```bash
wrangler secret put POSTHOG_KEY
```

Configure image-generation email alerts in PostHog, not in Spoonjoy code. Recommended filters:

- `$exception` where `feature = recipe_image_generation`
- `$exception` where `feature = recipe_image_generation` and `provider`, `model`, `errorCode`, `requestId`, or `fallbackAttempted` match the provider failure you want to page on
- `spoonjoy.image_generation.provider_fallback` where `provider`, `model`, `errorCode`, `fallbackProvider`, or `fallbackModel` match recovered provider failures that should still alert
- `spoonjoy.image_generation.skipped` where `reason` is `missing_image_provider_config`, `missing_runner`, or `quota_exhausted`

To enable client analytics in the production bundle, provide these public build-time values to the deploy environment without committing the key:

```bash
VITE_POSTHOG_KEY=...
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_DISABLED=
```

## Local `.dev.vars`

For local OAuth or AI testing, mirror the same names in `.dev.vars`:

```bash
SESSION_SECRET=local-dev-secret-change-me
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_IMAGE_TIMEOUT_MS=30000
IMAGE_PROVIDER_PRIMARY=gemini
IMAGE_PROVIDER_FALLBACKS=openai
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
POSTHOG_KEY=
POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_DISABLED=
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_DISABLED=
INGREDIENT_PARSE_PROVIDER=openai
INGREDIENT_PARSE_MODEL=gpt-4o-mini
INGREDIENT_PARSE_TIMEOUT_MS=8000
INGREDIENT_PARSE_MAX_RETRIES=1
```

Basic local app development does not require these values. The app uses safe local fallbacks for sessions and stores uploaded images as data URLs when the `PHOTOS` binding is unavailable.

## Preflight

Run the machine-checkable preflight before production deploys:

```bash
pnpm run deploy:preflight
```

The preflight verifies:

- `wrangler.json` has the Worker entry, `nodejs_compat`, D1 `DB`, and R2 `PHOTOS`.
- `package.json` exposes the expected build, test, e2e, deploy, `deploy:auto`, and preflight scripts.
- `package.json` exposes `smoke:api` for live third-party API/docs/playground drift checks.
- `app/cloudflare-env.d.ts` types the Cloudflare bindings and documented secrets.
- README/deployment docs mention required bindings, secrets, and deploy commands.
- README/deployment docs mention optional PostHog client setup, server lifecycle telemetry, `POSTHOG_KEY`, `POSTHOG_DISABLED`, `VITE_POSTHOG_KEY`, and `VITE_POSTHOG_DISABLED`.
- Numbered SQL migrations exist in `migrations/`.
- **Remote D1 migrations**: the preflight invokes `pnpm exec wrangler d1 migrations list DB --remote` and FAILS if any migrations are pending against the remote database. This guards against deploying application code that depends on a schema the remote database has not yet applied (the failure mode that caused the 2026-05-10 `/search` 500 incident).

### Remote check outcomes

| State | Result |
| --- | --- |
| Remote D1 reports no pending migrations | PASS |
| Remote D1 reports one or more pending migrations | FAIL — names of pending migrations are printed |
| Wrangler exits with an auth-keyed stderr (missing login, missing API token, code 10000, etc.) | WARN — preflight does not fail the deploy on missing auth, but the operator must verify manually |
| Wrangler exits non-zero for any other reason | FAIL |
| Wrangler stdout is not parseable as migration status | FAIL |
| Wrangler binary cannot be spawned (`ENOENT`, etc.) | FAIL |

### Skipping the remote check

Set `SPOONJOY_PREFLIGHT_SKIP_REMOTE=1` to skip the remote D1 migration check. The preflight will still emit a WARN line so the skip is visible in CI logs. Use this in:

- CI runs that do not have wrangler credentials.
- Local dev machines without `wrangler login`.
- Smoke runs of `pnpm run deploy:preflight` from sandboxes.

Do not set this in production deploy workflows — the whole point of the check is to catch unapplied migrations before they reach users.

## Production Deploy Flow

The shortest path for a production release is `pnpm deploy:auto`, which chains:

```
SPOONJOY_PREFLIGHT_SKIP_REMOTE=1 pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler d1 migrations apply DB --remote && pnpm run deploy:preflight && pnpm exec wrangler deploy
```

In one command this:

1. Runs local deploy preflight checks while skipping only the remote-migration check.
2. Builds the client bundle.
3. Applies any pending remote D1 migrations.
4. Reruns the full preflight, including the remote-migration check.
5. Deploys the Worker.

For full deploys with the longer test/typecheck gate:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm run deploy:preflight
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
pnpm deploy:auto
```

If you prefer the manual two-step (no auto-apply of migrations), use:

```bash
pnpm run deploy:preflight
wrangler d1 migrations apply DB --remote
pnpm run deploy
```

`pnpm run deploy` runs `pnpm run deploy:preflight && pnpm run build && pnpm exec wrangler deploy`; keep that chain so deploys never publish an unbuilt client bundle or skip the remote-migration check. Use `pnpm run deploy`; bare `pnpm deploy` is pnpm's workspace deploy command and will not run this package script.

## Failure Modes

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| OAuth buttons redirect back with `oauthError` | Missing or mismatched OAuth secret/callback config | Re-check provider callback URLs and `wrangler secret put` values |
| Uploaded images work locally but not in production | Missing `PHOTOS` R2 bucket/binding or R2 is not enabled for the deploy account | Enable R2 in the Dashboard, create `spoonjoy-photos`, and verify `wrangler.json` binding |
| Ingredient parsing returns fallback/manual review | Missing or invalid `OPENAI_API_KEY` | Set the secret or keep deterministic fallback behavior |
| Production schema is stale | D1 migrations not applied remotely | Run `wrangler d1 migrations apply DB --remote` before deploy, or use `pnpm deploy:auto` to apply + deploy in one step |
| `pnpm run deploy:preflight` fails with "Remote D1 has N pending migration(s)" | Local code references a schema change that has not been applied to remote D1 | Run `pnpm exec wrangler d1 migrations apply DB --remote` or `pnpm deploy:auto` (which applies pending migrations, reruns preflight, then deploys) |
| Intermittent 1102 / "Worker exceeded CPU time limit" on SSR routes | Worker Free CPU headroom is too close to React Router SSR + Prisma/D1 render cost | Reproduce with `wrangler tail`, then either reduce the hot route's server work or move the Worker to a paid plan before setting `limits.cpu_ms` |
| Sessions reset across deploys | Missing/rotating `SESSION_SECRET` | Set a stable high-entropy production secret |
